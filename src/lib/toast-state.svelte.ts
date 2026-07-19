/**
 * Transient feedback for actions whose result isn't otherwise visible on the
 * page — "invite sent", "couldn't save". Anything the page already re-renders
 * (a new purchase appearing in the list) doesn't need one.
 */

const DISMISS_MS = 3000;

export interface Toast {
	id: number;
	kind: 'success' | 'error';
	message: string;
}

let items = $state<Toast[]>([]);
let nextId = 0;

export const toasts = {
	get value() {
		return items;
	}
};

export function dismiss(id: number) {
	items = items.filter((t) => t.id !== id);
}

function push(kind: Toast['kind'], message: string) {
	const id = nextId++;
	items = [...items, { id, kind, message }];
	setTimeout(() => dismiss(id), DISMISS_MS);
}

export function toastSuccess(message: string) {
	push('success', message);
}

export function toastError(message: string) {
	push('error', message);
}
