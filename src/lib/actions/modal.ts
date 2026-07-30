/**
 * Svelte action for a hand-rolled modal panel: focus trap, initial focus,
 * focus restoration, and inertness of the page behind it.
 *
 * `ImageViewer` gets all of this free from `<dialog showModal>`, and that is
 * still the right answer wherever it fits. It doesn't fit here: these panels
 * animate in with Svelte transitions and sit inside the workspace layout's
 * stacking and safe-area context, both of which the top layer takes away. So
 * the platform behaviours are reimplemented — deliberately, in one place, once
 * — rather than per modal.
 *
 * Escape and outside-click stay with `use:dismiss`, which every one of these
 * panels already pairs with. This action never closes anything; it only governs
 * focus. Keeping the two separate means a panel can opt into either.
 *
 * Applied to the panel element, alongside `role="dialog" aria-modal="true"`.
 */

/**
 * Focusable candidates, in DOM order. `:not([disabled])` matters for the
 * confirm dialog, whose buttons disable mid-submit — a trap that can cycle onto
 * a disabled control strands the keyboard.
 */
const FOCUSABLE = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled]):not([type="hidden"])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])'
].join(',');

export interface ModalOptions {
	/**
	 * Where focus lands when the panel opens. A CSS selector resolved within the
	 * panel; falls back to the first focusable element, then the panel itself.
	 *
	 * The confirm dialog passes its Cancel button for destructive actions: after
	 * arming a delete with Enter, that same keypress must not land on Confirm.
	 */
	initial?: string;
	/**
	 * Skip moving focus on open. For the command palette, which focuses its own
	 * input on a rAF and would otherwise be fighting this action for the caret.
	 */
	skipInitialFocus?: boolean;
}

function focusable(node: HTMLElement): HTMLElement[] {
	return [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
		// offsetParent is null for display:none subtrees — a collapsed section
		// inside the panel shouldn't be a stop on the way round.
		(el) => el.offsetParent !== null || el === document.activeElement
	);
}

export function modal(node: HTMLElement, options: ModalOptions = {}) {
	let opts = options;

	// Captured before focus moves, restored on teardown: closing a modal should
	// put you back on the control that opened it, not at the top of the page.
	const opener = document.activeElement as HTMLElement | null;

	// The panel must be focusable itself, both as the fallback target and so the
	// trap has somewhere to go when the panel holds no focusable controls.
	if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');

	/*
	 * Everything that is not this modal (or its backdrop) goes inert: the
	 * background stops taking pointer events, stops being reachable by Tab, and
	 * is hidden from assistive tech — the three things `showModal` does that a
	 * z-index alone does not. Marked siblings are recorded so teardown only
	 * clears what this action set, which keeps stacked modals (a confirm opened
	 * from the filter panel) from un-inerting each other's background.
	 */
	const inerted: HTMLElement[] = [];
	for (const el of document.body.children) {
		if (!(el instanceof HTMLElement)) continue;
		if (el.contains(node) || node.contains(el)) continue;
		if (el.inert) continue;
		el.inert = true;
		inerted.push(el);
	}

	// The panel is usually a direct child of <body>'s wrapper, so the loop above
	// often finds nothing to inert. Walk up from the panel and inert each
	// ancestor's *other* children — that covers the app shell either way.
	for (let p = node.parentElement; p && p !== document.body; p = p.parentElement) {
		for (const el of p.children) {
			if (!(el instanceof HTMLElement)) continue;
			if (el.contains(node) || el === node) continue;
			if (el.inert) continue;
			el.inert = true;
			inerted.push(el);
		}
	}

	if (!opts.skipInitialFocus) {
		// After the transition's first frame, or the element isn't laid out yet
		// and focus() silently no-ops.
		requestAnimationFrame(() => {
			const target = opts.initial ? node.querySelector<HTMLElement>(opts.initial) : null;
			(target ?? focusable(node)[0] ?? node).focus();
		});
	}

	const onKeydown = (e: KeyboardEvent) => {
		if (e.key !== 'Tab') return;
		const items = focusable(node);
		if (items.length === 0) {
			e.preventDefault();
			node.focus();
			return;
		}
		const first = items[0];
		const last = items[items.length - 1];
		const active = document.activeElement;

		// Wrap at both ends. Also catches focus that has somehow escaped the panel
		// (a background element that dodged inert), pulling it back in.
		if (e.shiftKey && (active === first || !node.contains(active))) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && (active === last || !node.contains(active))) {
			e.preventDefault();
			first.focus();
		}
	};

	node.addEventListener('keydown', onKeydown);
	// Capture on the document too: focus can be moved by the browser to a
	// background element before the panel's own handler would ever see the key.
	document.addEventListener('keydown', onKeydown, true);

	return {
		update(next: ModalOptions = {}) {
			opts = next;
		},
		destroy() {
			node.removeEventListener('keydown', onKeydown);
			document.removeEventListener('keydown', onKeydown, true);
			for (const el of inerted) el.inert = false;
			// isConnected: if the opener was itself removed by the action that closed
			// the modal, focusing it throws focus to <body>. Better to leave focus
			// where the new page put it than to reset it to nowhere.
			if (opener?.isConnected) opener.focus();
		}
	};
}
