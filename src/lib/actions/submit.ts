import { applyAction, enhance } from '$app/forms';
import { invalidateAll } from '$app/navigation';
import type { ActionResult } from '@sveltejs/kit';
import { toastError, toastSuccess } from '$lib/toast-state.svelte';
import { requestConfirm, type ConfirmSpec } from '$lib/confirm-state.svelte';
import { beginSubmit, endSubmit } from '$lib/submit-state.svelte';

export interface SubmitOptions {
	/**
	 * Confirmation gate for destructive actions. A string is shown as the prompt
	 * title; an object gives a title, body and button styling. Declining cancels
	 * the submit. Rendered by the app's ConfirmDialog, not window.confirm.
	 */
	confirm?: string | ConfirmSpec;
	/** Toast shown when the action succeeds. Omit when the page shows the result. */
	success?: string;
	/** Runs after a successful submit; use for page-local state resets. */
	onSuccess?: () => void;
	/**
	 * Reset the form to its initial values after the action completes. Defaults
	 * to true; set to false for settings-style forms where the user should keep
	 * what they typed even after a validation error or successful save.
	 */
	reset?: boolean;
}

/**
 * Svelte action: `use:enhance` plus the three things every form here wants —
 * a confirm gate on destructive actions, a pending state while in flight (so
 * the submit button can't be double-fired), and a toast for results the page
 * doesn't otherwise surface.
 *
 * Pending state is exposed as `data-submitting` on the form; layout.css styles
 * the submit button from that, so the markup stays clean.
 *
 * It is also the single place the demo build diverges. 67 of the app's 71 forms
 * come through here, so the demo needs no per-form changes: when there is no
 * server to post to, the action runs in the tab and its outcome is fed to the
 * same `settle` below. `__DEMO__` is a build-time constant, so the branch and
 * its dynamic import vanish from the production bundle rather than shipping
 * PGlite to everyone.
 */
export function submit(node: HTMLFormElement, options: SubmitOptions = {}) {
	let opts = options;

	const buttons = () =>
		node.querySelectorAll<HTMLButtonElement>('button[type="submit"], button:not([type])');

	const setPending = (pending: boolean) => {
		if (pending) node.dataset.submitting = 'true';
		else delete node.dataset.submitting;
		node.setAttribute('aria-busy', String(pending));
		for (const b of buttons()) b.disabled = pending;
	};

	// Set once the styled confirm has been accepted, so the re-submit it triggers
	// sails past the gate instead of prompting again.
	let confirmed = false;

	// True from the moment a submission is actually in flight until it settles.
	// A redirect result keeps it true through the navigation (cleared on destroy),
	// so the live-refresh SSE can't invalidate mid-redirect. See submit-state.
	let counted = false;
	const markBusy = () => {
		if (!counted) {
			counted = true;
			beginSubmit();
		}
	};
	const clearBusy = () => {
		if (counted) {
			counted = false;
			endSubmit();
		}
	};

	/**
	 * What to do once an action has answered. Named rather than inline because
	 * the demo path has to invoke it directly — `enhance` only calls back for a
	 * submission it actually sent, and in the demo nothing is sent.
	 */
	const settle = async ({
		result,
		update
	}: {
		result: ActionResult;
		update: (opts?: { reset?: boolean }) => Promise<void>;
	}) => {
		if (result.type === 'redirect') {
			// A successful action that redirects: we're leaving this page. Keep the
			// form disabled through the navigation — clearing pending here flips the
			// buttons back to live while the (often slow) destination load is still
			// in flight, and a second tap then fires a duplicate submit that can
			// wedge the navigation, stranding the progress bar on a page whose
			// submit already succeeded. `counted` likewise stays set until destroy,
			// so a background SSE invalidateAll can't land mid-redirect and drop it.
			await applyAction(result);
			return;
		}
		setPending(false);
		clearBusy();
		const reset = opts.reset ?? true;
		if (result.type === 'success') {
			if (opts.success) toastSuccess(opts.success);
			opts.onSuccess?.();
			await update({ reset });
		} else if (result.type === 'failure') {
			// The page renders `form.error` inline; only speak up when it can't.
			if (!(result.data as { error?: string } | undefined)?.error) {
				toastError('Something went wrong. Try again.');
			}
			await update({ reset });
		} else {
			// result.type === 'error'. A dropped connection surfaces here as a
			// generic fetch failure, and "Something went wrong" then reads as "the
			// app is broken" when the real answer is "you're on the tube". Say which
			// it is, and — importantly — that nothing was saved, so the person knows
			// to try again rather than assuming it went through. Returning without
			// applyAction keeps them on the page they filled in, rather than
			// replacing it with an error screen that discards what they typed.
			if (typeof navigator !== 'undefined' && navigator.onLine === false) {
				toastError("You're offline, this didn't save");
				return;
			}
			toastError(result.error?.message ?? 'Something went wrong. Try again.');
			await applyAction(result);
		}
	};

	const enhanced = enhance(node, ({ cancel, submitter, formData, action }) => {
		if (opts.confirm && !confirmed) {
			cancel();
			const spec: ConfirmSpec =
				typeof opts.confirm === 'string' ? { title: opts.confirm } : opts.confirm;
			void requestConfirm(spec).then((ok) => {
				if (ok) {
					confirmed = true;
					// Re-submit through the same button. A bare requestSubmit() posts no
					// submitter, so a form whose buttons carry the choice (name="intent",
					// value="log" | "request") would lose it on the way through the gate
					// and land as a different action than the one that was confirmed.
					node.requestSubmit(submitter);
				}
			});
			return;
		}
		confirmed = false;
		setPending(true);
		markBusy();

		if (__DEMO__) {
			cancel();
			void (async () => {
				const { runDemoAction } = await import('$lib/demo/actions');
				const result = await runDemoAction(action, formData);
				await settle({
					result,
					update: async ({ reset = true } = {}) => {
						// What enhance's own `update` does: apply the result to `form`,
						// re-run the loads so the page reflects the write, and clear the
						// inputs unless the caller asked to keep them.
						if (reset) node.reset();
						await applyAction(result);
						await invalidateAll();
					}
				});
			})();
			return;
		}

		return settle;
	});

	return {
		update(next: SubmitOptions) {
			opts = next;
		},
		destroy() {
			setPending(false);
			// Redirect submits leave `counted` set on purpose; the navigation that
			// unmounts this form is where it's finally released.
			clearBusy();
			enhanced.destroy();
		}
	};
}
