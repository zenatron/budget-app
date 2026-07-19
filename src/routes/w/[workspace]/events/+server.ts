import { subscribe } from '$lib/infra/events/bus';
import { getDb } from '$lib/server/db';
import { findWorkspaceForMember } from '$lib/server/repo/workspaces';
import type { RequestHandler } from './$types';

const PING_INTERVAL_MS = 30_000;

/**
 * Workspace-scoped SSE stream (server→client only). Membership is enforced by
 * hooks; seal filtering is per-subscriber inside the bus. Clients treat any
 * message as an invalidation signal.
 *
 * Hooks authorize once, at connect. A stream is long-lived, so membership is
 * re-checked on each ping — otherwise a removed member keeps receiving
 * workspace events until they happen to reconnect.
 */
export const GET: RequestHandler = ({ locals, request }) => {
	const workspaceId = locals.workspace!.id;
	const memberId = locals.member!.id;
	const slug = locals.workspace!.slug;
	const userId = locals.user!.id;

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();
			const write = (chunk: string) => {
				try {
					controller.enqueue(encoder.encode(chunk));
				} catch {
					// stream already closed
				}
			};
			write(`data: {"type":"hello"}\n\n`);
			const unsubscribe = subscribe(workspaceId, {
				memberId,
				send: (json) => write(`data: ${json}\n\n`)
			});
			const teardown = () => {
				clearInterval(ping);
				unsubscribe();
				try {
					controller.close();
				} catch {
					// already closed
				}
			};

			const ping = setInterval(() => {
				void (async () => {
					const ctx = await findWorkspaceForMember(getDb(), slug, userId);
					if (!ctx || ctx.member.id !== memberId) {
						teardown();
						return;
					}
					write(`: ping\n\n`);
				})();
			}, PING_INTERVAL_MS);

			request.signal.addEventListener('abort', teardown);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
