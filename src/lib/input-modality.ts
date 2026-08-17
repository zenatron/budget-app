/**
 * Track whether the person is currently driving with a keyboard or a pointer,
 * as `data-input` on <html>.
 *
 * `:focus-visible` already answers this for buttons and links: click one and it
 * does not match, tab to it and it does. Text controls are deliberately exempt
 * — a focused text field always matches, however it was reached, because you
 * are about to type and need to see where. That is correct on a desktop and
 * pure clutter on a phone, where every tap on a field paints a ring.
 *
 * So this supplies the one bit `:focus-visible` will not: what the last input
 * was. Deliberately *not* screen size or display-mode — neither says anything
 * about how someone is navigating, and gating on them takes the focus ring away
 * from a keyboard user on a small screen, which is a WCAG 2.4.7 failure rather
 * than a tidier UI.
 *
 * Only navigation keys flip it back to keyboard. Typing inside a field the
 * pointer opened should not suddenly draw a ring around it.
 */
const NAV_KEYS = new Set([
	'Tab',
	'ArrowUp',
	'ArrowDown',
	'ArrowLeft',
	'ArrowRight',
	'Home',
	'End',
	'PageUp',
	'PageDown'
]);

export function trackInputModality(): () => void {
	if (typeof document === 'undefined') return () => {};

	const set = (mode: 'keyboard' | 'pointer') => {
		document.documentElement.dataset.input = mode;
	};

	const onKeyDown = (e: KeyboardEvent) => {
		if (NAV_KEYS.has(e.key)) set('keyboard');
	};
	// Pointer-down rather than click: it lands before focus, so the ring never
	// paints for a frame on the way to being suppressed.
	const onPointerDown = () => set('pointer');

	document.addEventListener('keydown', onKeyDown, true);
	document.addEventListener('pointerdown', onPointerDown, true);

	return () => {
		document.removeEventListener('keydown', onKeyDown, true);
		document.removeEventListener('pointerdown', onPointerDown, true);
	};
}
