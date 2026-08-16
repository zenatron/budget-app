import { isActionFailure, isRedirect, type ActionResult } from '@sveltejs/kit';
import { base } from '$app/paths';
import { getDemoContext } from './context';
import type { WorkspaceContext } from '$lib/ports/context';

/* eslint-disable @typescript-eslint/no-explicit-any */
type DemoAction = (ctx: WorkspaceContext, event: any) => any;

const registry = new Map<string, Record<string, DemoAction>>();

/**
 * Called by each generated `+page.ts` at module load, so a form submitted on
 * that route can find its handlers without the form knowing anything about
 * routing. Keyed by SvelteKit's route id, which is what `page.route.id` gives
 * us at submit time.
 */
export function registerDemoActions(routeId: string, actions: Record<string, DemoAction>): void {
	registry.set(routeId, actions);
}

/**
 * Run a form action in the tab, and answer in the shape the server would have.
 *
 * `use:submit` normally POSTs to `?/name` and gets an ActionResult back. There
 * is nothing to POST to here, so this calls the very same action function the
 * server binds and maps its outcome onto the same three cases: a returned
 * object is a success, `fail()` is a failure, and `redirect()` throws and comes
 * back as a redirect. Everything downstream — toasts, `form.error`, pending
 * state — is then identical to the server path, which is why none of the 67
 * forms in the app needed touching.
 */
export async function runDemoAction(
	routeId: string | null,
	action: URL,
	formData: FormData
): Promise<ActionResult> {
	const actions = routeId ? registry.get(routeId) : undefined;
	if (!actions) {
		return {
			type: 'error',
			status: 404,
			error: new Error(`demo: no actions registered for route ${routeId}`)
		};
	}

	// SvelteKit names the action in the query string: `?/create`. A bare `?/`
	// (or nothing at all) means the default action.
	const named = action.search.startsWith('?/') ? action.search.slice(2) : '';
	const name = named || 'default';
	const fn = actions[name];
	if (!fn) {
		return {
			type: 'error',
			status: 404,
			error: new Error(`demo: route ${routeId} has no action "${name}"`)
		};
	}

	try {
		const ctx = await getDemoContext(base);
		const request = new Request(action, { method: 'POST', body: formData });
		const data = await fn(ctx, { request, params: {}, url: action });

		if (isActionFailure(data)) {
			return {
				type: 'failure',
				status: data.status,
				data: data.data as Record<string, unknown> | undefined
			};
		}
		return { type: 'success', status: 200, data: data ?? undefined };
	} catch (e) {
		if (isRedirect(e)) return { type: 'redirect', status: e.status, location: e.location };
		return { type: 'error', status: 500, error: e };
	}
}
