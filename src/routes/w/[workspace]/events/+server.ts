import { subscribe } from '$lib/infra/events/bus';
import type { RequestHandler } from './$types';

const PING_INTERVAL_MS = 30_000;

/**
 * Workspace-scoped SSE stream (server→client only). Membership is enforced by
 * hooks; seal filtering is per-subscriber inside the bus. Clients treat any
 * message as an invalidation signal.
 */
export const GET: RequestHandler = ({ locals, request }) => {
	const workspaceId = locals.workspace!.id;
	const memberId = locals.member!.id;

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
			const ping = setInterval(() => write(`: ping\n\n`), PING_INTERVAL_MS);
			request.signal.addEventListener('abort', () => {
				clearInterval(ping);
				unsubscribe();
				try {
					controller.close();
				} catch {
					// already closed
				}
			});
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
