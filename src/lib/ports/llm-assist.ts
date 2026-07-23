import type { Choice } from '$lib/domain/intelligence/constrain';

/**
 * The port Harmony's optional LLM assist speaks through. Deliberately narrow:
 * the model is a *fuzzy reducer*, so it may only ever pick from a set the caller
 * already owns, or clean a string. It has no method that acts, spends, approves,
 * or writes — those live entirely in the deterministic core, and the assist
 * layer can be absent (the null adapter) with zero behaviour change.
 *
 * Neither `pickChoice` nor `cleanLabel` ever throws: any failure (off, offline,
 * timeout, garbage) resolves to null, and the caller falls back to exactly what
 * it would have done with no model at all.
 */

export interface AssistProvider {
	mode: 'off' | 'local' | 'external';
	endpoint: string | null;
	model: string | null;
}

export interface LlmAssist {
	/** False whenever the layer is off or misconfigured — callers gate on this. */
	readonly available: boolean;

	/** For the settings screen: what this instance is pointed at. */
	describe(): AssistProvider;

	/** Health check for the settings screen. Never throws. */
	ping(): Promise<{ ok: boolean; detail: string }>;

	/**
	 * Reduce messy `text` to the id of one of `choices`, or null. The model's raw
	 * answer is always forced back through `constrainToChoice`, so anything it
	 * invents becomes null rather than a wrong pick.
	 */
	pickChoice(req: { instruction: string; text: string; choices: Choice[] }): Promise<string | null>;

	/**
	 * Normalize `text` to a short clean label (a merchant name from a bank
	 * descriptor, say), or null. Passed through `sanitizeLabel` before return.
	 */
	cleanLabel(req: { instruction: string; text: string; maxLen?: number }): Promise<string | null>;
}
