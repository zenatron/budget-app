/**
 * App-wide confirmation prompts, styled to match the product instead of the
 * browser's chrome `window.confirm`. A caller awaits `requestConfirm(...)`; the
 * ConfirmDialog rendered in the workspace layout shows the prompt and resolves
 * the promise with the user's answer.
 *
 * `use:submit` routes its `confirm` option through here, so every destructive
 * form in the app gets the same modal for free.
 */

export interface ConfirmSpec {
	title: string;
	/** Optional supporting line(s) under the title. */
	body?: string;
	confirmLabel?: string;
	cancelLabel?: string;
	/** `danger` paints the confirm button in the deny colour. */
	tone?: 'default' | 'danger';
}

interface Pending extends ConfirmSpec {
	resolve: (ok: boolean) => void;
}

let current = $state<Pending | null>(null);

export const confirmState = {
	get current(): Pending | null {
		return current;
	}
};

export function requestConfirm(spec: ConfirmSpec): Promise<boolean> {
	// A new prompt supersedes any still on screen — answer the old one "no".
	current?.resolve(false);
	return new Promise<boolean>((resolve) => {
		current = { ...spec, resolve };
	});
}

export function answerConfirm(ok: boolean): void {
	current?.resolve(ok);
	current = null;
}
