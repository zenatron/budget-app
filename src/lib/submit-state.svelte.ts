/**
 * How many `use:submit` forms currently have a request in flight (or a redirect
 * navigation still settling). The workspace layout's live-refresh SSE listener
 * consults this before running a background `invalidateAll()`.
 *
 * The reason is a race that strands the progress bar: an action that ends in a
 * redirect (logging or requesting a purchase) publishes its SSE event *before*
 * it finishes — so the submitter's own browser schedules an `invalidateAll()`
 * that can land right as the redirect is being applied, clobbering the
 * navigation. The redirect gets dropped, `navigating` is left populated, and the
 * loading bar loops forever even though the write succeeded. Deferring the
 * background refresh until the submit settles removes the race; the redirect
 * already refreshes its destination on its own, so nothing is lost.
 */
let inflight = $state(0);

export const submitting = {
	get active() {
		return inflight > 0;
	}
};

export function beginSubmit(): void {
	inflight += 1;
}

export function endSubmit(): void {
	inflight = Math.max(0, inflight - 1);
}
