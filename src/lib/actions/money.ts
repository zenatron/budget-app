/**
 * Svelte action: constrain an <input> to a valid money value as the user types.
 * Digits and a single decimal point, at most two fraction digits. Pairs with
 * server-side Money.fromDecimal — this is field-level polish, not the guard.
 */
export function money(node: HTMLInputElement) {
	function clean() {
		const start = node.selectionStart;
		let v = node.value.replace(/[^0-9.]/g, '');
		const dot = v.indexOf('.');
		if (dot !== -1) {
			// keep the first dot, drop the rest, cap at two decimals
			v =
				v.slice(0, dot + 1) +
				v
					.slice(dot + 1)
					.replace(/\./g, '')
					.slice(0, 2);
		}
		if (v !== node.value) {
			const delta = node.value.length - v.length;
			node.value = v;
			if (start !== null) node.setSelectionRange(start - delta, start - delta);
			node.dispatchEvent(new Event('change', { bubbles: true }));
		}
	}
	node.addEventListener('input', clean);
	return {
		destroy() {
			node.removeEventListener('input', clean);
		}
	};
}
