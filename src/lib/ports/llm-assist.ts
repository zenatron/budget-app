import type { Choice } from '$lib/domain/intelligence/constrain';

/**
 * The port Harmony's optional LLM assist speaks through. Deliberately narrow:
 * the model is a *fuzzy reducer*, so it may only ever pick from a set the caller
 * already owns, or clean a string. It has no method that acts, spends, approves,
 * or writes — those live entirely in the deterministic core, and the assist
 * layer can be absent (the null adapter) with zero behaviour change.
 *
 * Neither `pickChoice`, `cleanLabel`, nor `parseCommand` ever throws: any
 * failure (off, offline, timeout, garbage) resolves to null, and the caller
 * falls back to exactly what it would have done with no model at all.
 */

/** Targets the palette's deterministic parser already knows how to open. */
export type NavigateTarget =
	'analytics' | 'buckets' | 'recurring' | 'income' | 'purchases' | 'settings';

/**
 * A structured action the model extracted from free text. The set is
 * intentionally small and constructive: the model is never allowed to propose
 * deletes, edits, spending, approvals, or money movement. Anything outside this
 * set resolves to `unknown`.
 */
export type ParsedAction =
	| { intent: 'create_bucket'; name: string; amount: number; dayOfMonth: number }
	| {
			intent: 'create_income';
			source: string;
			amount: number;
			monthly: boolean;
			dayOfMonth: number;
	  }
	| { intent: 'log_purchase' }
	| { intent: 'navigate'; target: NavigateTarget }
	| { intent: 'unknown' };

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

	/**
	 * Parse a free-text command into one of the safe, constructive actions the
	 * app can prepare for confirmation. Returns `unknown` when the text is a
	 * question, a destructive operation, or anything outside the allowed set.
	 * The caller still validates every field before showing a proposal.
	 */
	parseCommand(req: { query: string }): Promise<ParsedAction | null>;

	/**
	 * Answer a natural-language question about the workspace's finances, grounded
	 * strictly in the `briefing` the caller supplies. This is the one method that
	 * *narrates* rather than reduces — but it stays inside the same guarantee: the
	 * numbers are computed deterministically by the caller and handed in as text;
	 * the model only phrases an answer over them and may never invent a figure or
	 * take an action. Returns null when off, unreachable, or empty, so the caller
	 * falls back to its deterministic "I couldn't understand that" reply.
	 */
	answerQuestion(req: { query: string; briefing: string }): Promise<string | null>;
}
