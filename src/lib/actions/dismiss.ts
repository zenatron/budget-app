/**
 * Svelte action for the click-catcher behind a popover: closes on outside
 * click, and on Escape from anywhere. The keydown listener goes on the document
 * rather than the catcher element — a backdrop div never holds focus, so a
 * handler bound to it would never fire, which is why the old `onkeydown={() =>
 * {}}` stubs did nothing.
 */
export function dismiss(node: HTMLElement, onDismiss: () => void) {
	let close = onDismiss;

	const onClick = () => close();
	const onKeydown = (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			e.stopPropagation();
			close();
		}
	};

	node.addEventListener('click', onClick);
	document.addEventListener('keydown', onKeydown);

	return {
		update(next: () => void) {
			close = next;
		},
		destroy() {
			node.removeEventListener('click', onClick);
			document.removeEventListener('keydown', onKeydown);
		}
	};
}
