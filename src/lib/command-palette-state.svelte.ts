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

export type Proposal =
	| {
			intent: 'create_bucket';
			name: string;
			amount: number;
			amountMinor: string;
			dayOfMonth: number;
			currency: string;
	  }
	| {
			intent: 'create_income';
			source: string;
			amount: number;
			amountMinor: string;
			monthly: boolean;
			dayOfMonth: number;
			currency: string;
	  }
	| {
			intent: 'navigate';
			target: string;
			label: string;
	  };

export type PaletteResponse = {
	intent: string;
	answer: string;
	detail?: { label: string; amountMinor: string }[];
	target?: string;
	describe?: string;
	propose?: Proposal;
};

export const paletteOpen = createBoxedState(false);
export const paletteQuery = createBoxedState('');
export const paletteLoading = createBoxedState(false);
export const paletteResponse = createBoxedState<PaletteResponse | null>(null);
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

function handleResult(data: PaletteResponse) {
	paletteResponse.value = data;
	if (data.describe) {
		// Hand the sentence to the Add screen, which parses and prefills it.
		close();
		void goto(
			`/w/${page.params.workspace}/purchases/new?describe=${encodeURIComponent(data.describe)}`
		);
	}
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
		const data = (await res.json()) as PaletteResponse;
		handleResult(data);
	} catch {
		paletteResponse.value = { intent: 'error', answer: 'Something went wrong. Try again.' };
	}
	paletteLoading.value = false;
}

export async function executeProposal(proposal: Proposal) {
	if (paletteLoading.value) return;
	paletteLoading.value = true;
	try {
		const res = await fetch(`/w/${page.params.workspace}/intelligence/execute`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ proposal })
		});
		const data = (await res.json()) as PaletteResponse;
		if (data.describe) {
			close();
			void goto(
				`/w/${page.params.workspace}/purchases/new?describe=${encodeURIComponent(data.describe)}`
			);
		} else if (data.target) {
			close();
			void goto(`/w/${page.params.workspace}/${data.target}`);
		} else {
			paletteResponse.value = data;
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
