/**
 * Svelte action: fire a callback when an element is pressed and held, and
 * swallow the click that would otherwise follow. Used to hang a shortcut off the
 * FAB — a tap still navigates, a hold opens the quick-log sheet.
 *
 * The click-suppression is the fiddly part: after a long press the pointer's
 * release still dispatches a click, which on an <a> would navigate away from the
 * sheet we just opened. A one-shot capturing listener eats exactly that click.
 */
const HOLD_MS = 450;

export function longpress(node: HTMLElement, onLongpress: () => void) {
	let fire = onLongpress;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let suppressClick = false;

	const clear = () => {
		clearTimeout(timer);
		timer = undefined;
	};

	const onPointerDown = (e: PointerEvent) => {
		// Primary button / touch only; let modified or right clicks pass through.
		if (e.button !== 0) return;
		clear();
		timer = setTimeout(() => {
			suppressClick = true;
			fire();
		}, HOLD_MS);
	};

	const onClick = (e: MouseEvent) => {
		if (suppressClick) {
			e.preventDefault();
			e.stopPropagation();
			suppressClick = false;
		}
	};

	node.addEventListener('pointerdown', onPointerDown);
	node.addEventListener('pointerup', clear);
	node.addEventListener('pointerleave', clear);
	node.addEventListener('pointercancel', clear);
	// Capture so we intercept the click before the link's default navigation.
	node.addEventListener('click', onClick, true);

	return {
		update(next: () => void) {
			fire = next;
		},
		destroy() {
			clear();
			node.removeEventListener('pointerdown', onPointerDown);
			node.removeEventListener('pointerup', clear);
			node.removeEventListener('pointerleave', clear);
			node.removeEventListener('pointercancel', clear);
			node.removeEventListener('click', onClick, true);
		}
	};
}
