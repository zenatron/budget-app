import { applyAction, enhance } from '$app/forms';
import { toastError, toastSuccess } from '$lib/toast-state.svelte';

export interface SubmitOptions {
	/** Prompt text for destructive actions. Declining cancels the submit. */
	confirm?: string;
	/** Toast shown when the action succeeds. Omit when the page shows the result. */
	success?: string;
	/** Runs after a successful submit; use for page-local state resets. */
	onSuccess?: () => void;
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

	const enhanced = enhance(node, ({ cancel }) => {
		if (opts.confirm && !window.confirm(opts.confirm)) {
			cancel();
			return;
		}
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
			if (result.type === 'success') {
				if (opts.success) toastSuccess(opts.success);
				opts.onSuccess?.();
				await update();
			} else if (result.type === 'failure') {
				// The page renders `form.error` inline; only speak up when it can't.
				if (!(result.data as { error?: string } | undefined)?.error) {
					toastError('Something went wrong. Try again.');
				}
				await update();
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
