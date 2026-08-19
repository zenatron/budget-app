/**
 * Svelte action for a hand-rolled menu popover: the keyboard half of the ARIA
 * menu pattern — ArrowUp/Down roving focus, Home/End, and initial focus on a
 * keyboard open.
 *
 * Split the same way `use:modal` is: this action never closes anything, and
 * Escape/outside-click stay with `use:dismiss`, which the popover already
 * pairs with. Unlike a modal, a menu is not a trap: Tab is left alone (it
 * simply leaves, and the component closes on focusout), and the page behind
 * is not inerted — a menu is a detour, not a mode.
 *
 * Applied to the `role="menu"` element; its items carry `role="menuitem"`.
 * Whether focus moves on open is decided by input modality: a keyboard open
 * (ArrowDown on the trigger) lands on the first item, because the next
 * keypress must do something; a pointer open leaves focus where it was,
 * because a tap has already said what it wants.
 */
export function menu(node: HTMLElement) {
	const items = () =>
		[...node.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter(
			(el) => el.offsetParent !== null
		);

	const keyboard = () => document.documentElement.dataset.input === 'keyboard';

	if (keyboard()) {
		// A rAF, like modal's initial focus: the popover is usually revealed by
		// an in-progress transition, and focus() before layout silently no-ops.
		requestAnimationFrame(() => items()[0]?.focus());
	}

	const onKeydown = (e: KeyboardEvent) => {
		const list = items();
		if (list.length === 0) return;
		const at = list.indexOf(document.activeElement as HTMLElement);

		// Roving focus with wrap. `at === -1` means the menu container itself
		// holds focus (or nothing does): Down enters at the top, Up at the
		// bottom — the direction you were heading, per the ARIA pattern.
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			list[at < 0 ? 0 : (at + 1) % list.length].focus();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			list[at < 0 ? list.length - 1 : (at - 1 + list.length) % list.length].focus();
		} else if (e.key === 'Home') {
			e.preventDefault();
			list[0].focus();
		} else if (e.key === 'End') {
			e.preventDefault();
			list[list.length - 1].focus();
		}
	};

	node.addEventListener('keydown', onKeydown);
	return {
		destroy() {
			node.removeEventListener('keydown', onKeydown);
		}
	};
}
