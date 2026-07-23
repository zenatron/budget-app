import { goto } from '$app/navigation';
import { page } from '$app/state';

function createBoxedState<T>(initial: T) {
	let value = $state(initial);
	return {
		get value() {
			return value;
		},
		set value(v: T) {
			value = v;
		}
	};
}

export const paletteOpen = createBoxedState(false);
export const paletteQuery = createBoxedState('');
export const paletteLoading = createBoxedState(false);
export const paletteResponse = createBoxedState<{
	intent: string;
	answer: string;
	detail?: { label: string; amountMinor: bigint }[];
	target?: string;
} | null>(null);
export const paletteInputEl = createBoxedState<HTMLInputElement | null>(null);

export function toggle() {
	if (paletteOpen.value) {
		close();
	} else {
		paletteQuery.value = '';
		paletteResponse.value = null;
		paletteOpen.value = true;
		requestAnimationFrame(() => paletteInputEl.value?.focus());
	}
}

export function close() {
	paletteOpen.value = false;
}

/** Canned examples run straight away — the user picked a finished question. */
export function pickExample(prompt: string) {
	paletteQuery.value = prompt;
	void submit();
}

/**
 * Completions of a half-typed command go into the box instead of running, with
 * the cursor at the end: the suggested amount is a placeholder the user almost
 * always wants to change before committing.
 */
export function fillExample(prompt: string) {
	paletteQuery.value = prompt;
	const el = paletteInputEl.value;
	requestAnimationFrame(() => {
		el?.focus();
		el?.setSelectionRange(prompt.length, prompt.length);
	});
}

export async function submit() {
	const q = paletteQuery.value.trim();
	if (!q || paletteLoading.value) return;
	paletteLoading.value = true;
	paletteResponse.value = null;
	try {
		const res = await fetch(`/w/${page.params.workspace}/intelligence`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ query: q })
		});
		const data = await res.json();
		paletteResponse.value = data;
		if (data.describe) {
			// Hand the sentence to the Add screen, which parses and prefills it.
			close();
			void goto(
				`/w/${page.params.workspace}/purchases/new?describe=${encodeURIComponent(data.describe)}`
			);
		} else if (data.target) {
			setTimeout(() => {
				close();
				void goto(`/w/${page.params.workspace}/${data.target}`);
			}, 600);
		}
	} catch {
		paletteResponse.value = { intent: 'error', answer: 'Something went wrong. Try again.' };
	}
	paletteLoading.value = false;
}

export function handleKeydown(e: KeyboardEvent) {
	if (e.key === 'Escape') {
		if (paletteResponse.value) {
			paletteQuery.value = '';
			paletteResponse.value = null;
			paletteInputEl.value?.focus();
		} else {
			close();
		}
	}
}
