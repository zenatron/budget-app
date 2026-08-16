import type { WorkspaceContext } from '$lib/ports/context';

/**
 * Bind a workspace route's neutral handlers to the server's request context.
 *
 * `hooks.server.ts` has already resolved session → user → membership and put
 * the composed ports on locals, so this is a projection, not a lookup. The
 * non-null assertions are safe for exactly that reason: SvelteKit only reaches
 * a `/w/[workspace]` route after the hook has set all four, or 404'd.
 */
export function wsContext(locals: App.Locals): WorkspaceContext {
	return {
		db: locals.db,
		deps: locals.deps,
		user: locals.user!,
		workspace: locals.workspace!,
		member: locals.member!
	};
}

/** A ctx-taking handler, seen as SvelteKit sees it once the ctx is bound. */
type Bound<F> = F extends (ctx: WorkspaceContext, event: infer E) => infer R
	? (event: E) => R
	: never;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (ctx: WorkspaceContext, event: any) => any;

/**
 * `export const GET = bindEndpoint(h.GET)`
 *
 * The same binding as a page's, for `+server.ts`. Endpoints answer with a
 * Response rather than data, but they are otherwise the same shape — and the
 * demo needs them just as much, since a handful of the app's interactions
 * (ledger paging, the settings switches) are plain fetches rather than forms.
 */
export function bindEndpoint<F extends Handler>(fn: F): Bound<F> {
	return bindLoad(fn);
}

/** `export const load = bindLoad(h.load)` */
export function bindLoad<F extends Handler>(fn: F): Bound<F> {
	return ((event: Parameters<F>[1]) => fn(wsContext(event.locals), event)) as Bound<F>;
}

/**
 * `export const actions = bindActions(h.actions)`
 *
 * The mapped return type is what keeps `ActionData` inference alive — a plain
 * `Record<string, Function>` here would erase each action's return type and
 * quietly turn `form?.error` into `any` in every component.
 */
export function bindActions<A extends Record<string, Handler>>(
	actions: A
): { [K in keyof A]: Bound<A[K]> } {
	const out = {} as { [K in keyof A]: Bound<A[K]> };
	for (const key of Object.keys(actions) as (keyof A)[]) {
		out[key] = bindLoad(actions[key]) as Bound<A[keyof A]> as (typeof out)[keyof A];
	}
	return out;
}
