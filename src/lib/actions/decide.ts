import { applyAction } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import type { SubmitFunction } from '@sveltejs/kit';

/**
 * `use:enhance` for the forms that keep their own pending state, made to work
 * in the demo build too.
 *
 * Approve and Deny put a spinner inside the button they own, which `use:submit`
 * has no way to express, so they use SvelteKit's own `enhance` instead. That
 * posts to a server, and the static demo does not have one: both buttons failed
 * there with "Something went wrong" while every `use:submit` form on the same
 * page worked, because only `use:submit` carried the `__DEMO__` branch. Deciding
 * is the app's headline interaction, so having it be the one thing broken in the
 * shop window was the wrong way round.
 *
 * The branch is the same one `use:submit` runs, kept here rather than copied
 * into each form: two callers is exactly where a copied block starts drifting.
 * `__DEMO__` is a build-time constant, so the server build drops this entirely.
 */
export function decide(onStart: () => void, onDone: () => void): SubmitFunction {
	return ({ action, formData, cancel }) => {
		onStart();

		if (__DEMO__) {
			cancel();
			void (async () => {
				try {
					const { runDemoAction } = await import('$lib/demo/actions');
					const result = await runDemoAction(action, formData);
					await applyAction(result);
					// The decision changes the purchase's state, its chip and its audit
					// trail, none of which the action's return value carries.
					await invalidateAll();
				} finally {
					onDone();
				}
			})();
			return;
		}

		return async ({ update }) => {
			await update();
			onDone();
		};
	};
}
