import { applyAction, enhance } from '$app/forms';
import { toastError, toastSuccess } from '$lib/toast-state.svelte';
import { requestConfirm, type ConfirmSpec } from '$lib/confirm-state.svelte';

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

	const enhanced = enhance(node, ({ cancel }) => {
		if (opts.confirm && !confirmed) {
			cancel();
			const spec: ConfirmSpec =
				typeof opts.confirm === 'string' ? { title: opts.confirm } : opts.confirm;
			void requestConfirm(spec).then((ok) => {
				if (ok) {
					confirmed = true;
					node.requestSubmit();
				}
			});
			return;
		}
		confirmed = false;
		setPending(true);

		return async ({ result, update }) => {
			if (result.type === 'redirect') {
				// A successful action that redirects: we're leaving this page. Keep the
				// form disabled through the navigation — clearing pending here flips the
				// buttons back to live while the (often slow) destination load is still
				// in flight, and a second tap then fires a duplicate submit that can
				// wedge the navigation, stranding the progress bar on a page whose
				// submit already succeeded.
				await applyAction(result);
				return;
			}
			setPending(false);
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
				// result.type === 'error': let SvelteKit render its error page.
				toastError(result.error?.message ?? 'Something went wrong. Try again.');
				await applyAction(result);
			}
		};
	});

	return {
		update(next: SubmitOptions) {
			opts = next;
		},
		destroy() {
			setPending(false);
			enhanced.destroy();
		}
	};
}
