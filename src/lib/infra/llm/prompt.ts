import type { Choice } from '$lib/domain/intelligence/constrain';

/**
 * Shared prompt shaping for both HTTP adapters. The prompts are deliberately
 * strict and closed: the model is told to answer with only an option or the
 * word NONE, because everything it says is re-validated on our side anyway. A
 * tight prompt just means fewer answers get thrown away.
 */

export interface ChatMessage {
	role: 'system' | 'user';
	content: string;
}

export function choiceMessages(req: {
	instruction: string;
	text: string;
	choices: Choice[];
}): ChatMessage[] {
	const options = req.choices.map((c) => `- ${c.label}`).join('\n');
	return [
		{
			role: 'system',
			content:
				'You are a strict classifier. Reply with the single best option copied exactly, ' +
				'or the word NONE if nothing fits. No explanation, no punctuation, no other words.'
		},
		{
			role: 'user',
			content: `${req.instruction}\n\nText:\n"""${req.text}"""\n\nOptions:\n${options}\n\nAnswer:`
		}
	];
}

export function labelMessages(req: { instruction: string; text: string }): ChatMessage[] {
	return [
		{
			role: 'system',
			content:
				'You clean up messy text into a short human label. Reply with only the label, ' +
				'a few words at most, or the word NONE if you cannot. No explanation.'
		},
		{ role: 'user', content: `${req.instruction}\n\nText:\n"""${req.text}"""\n\nLabel:` }
	];
}

/**
 * Prompt for turning free text into a closed, safe action object. The allowed
 * intents are constructive-only: buckets, income, purchase logging, and page
 * navigation. Deletes, edits, spending approvals, or money movement are not in
 * the set, so a model can never autonomously trigger them.
 */
export function parseCommandMessages(query: string): ChatMessage[] {
	return [
		{
			role: 'system',
			content:
				'You parse user commands for a personal-finance assistant. ' +
				'Reply with ONLY a single JSON object containing an "intent" field. ' +
				'Allowed intents: create_bucket, create_income, log_purchase, navigate, unknown.\n\n' +
				'Examples:\n' +
				'{"intent":"create_bucket","name":"Vacation","amount":200,"dayOfMonth":1}\n' +
				'{"intent":"create_income","source":"Salary","amount":4800,"monthly":true,"dayOfMonth":1}\n' +
				'{"intent":"log_purchase"}\n' +
				'{"intent":"navigate","target":"purchases"}\n' +
				'{"intent":"unknown"}\n\n' +
				'Rules:\n' +
				'- amount is a number in dollars, no currency symbols.\n' +
				'- dayOfMonth is 1-28, or -1 for the last day of the month.\n' +
				'- target for navigate must be one of: analytics, buckets, recurring, income, purchases, settings.\n' +
				'- If the request is a question, output unknown.\n' +
				'- If the request could delete, edit, move, spend, approve, or send money, output unknown.\n' +
				'- No explanation, no markdown, no text outside the JSON object.'
		},
		{ role: 'user', content: query }
	];
}

/**
 * Prompt for answering a finance question grounded in a supplied briefing. The
 * hard rule is the whole safety story: the model may only use numbers that
 * appear in the briefing, must never invent or estimate one, and must admit when
 * the briefing doesn't hold the answer. It phrases; the caller has already done
 * the arithmetic.
 */
export function answerQuestionMessages(query: string, briefing: string): ChatMessage[] {
	return [
		{
			role: 'system',
			content:
				'You are Harmony, the calm, concise assistant inside a personal budgeting app. ' +
				'Answer the question using ONLY the figures in the briefing below. ' +
				'Never invent, estimate, or extrapolate a number that is not written there. ' +
				'If the briefing does not contain what is needed, say so plainly in one sentence and, ' +
				'when it helps, point to where in the app they could look (the Activity, Ledger, or Plan tab). ' +
				'Keep it to 1-3 short sentences, warm and direct, no markdown, no bullet lists, ' +
				'and use the currency exactly as it appears in the briefing.\n\n' +
				`Briefing:\n${briefing}`
		},
		{ role: 'user', content: query }
	];
}

/** One place to bound a call — local models can be slow, but not unbounded. */
export const ASSIST_TIMEOUT_MS = 15_000;

/**
 * Bound and clean a narrated answer. The model is trusted to phrase, not to be
 * unbounded: strip control characters, collapse runs of whitespace, and cap the
 * length so a runaway generation can't flood the palette. Returns null for an
 * empty result so the caller falls back deterministically.
 */
export function sanitizeAnswer(raw: string, maxLen = 600): string | null {
	const cleaned = Array.from(raw)
		.filter((c) => {
			const code = c.charCodeAt(0);
			return code > 0x1f || code === 0x0a; // keep newlines, drop other control chars
		})
		.join('')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	if (!cleaned) return null;
	return cleaned.length > maxLen ? cleaned.slice(0, maxLen).trimEnd() + '…' : cleaned;
}

export async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	timeoutMs = ASSIST_TIMEOUT_MS
): Promise<Response> {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		return await fetch(url, { ...init, signal: ctrl.signal });
	} finally {
		clearTimeout(t);
	}
}

/** Trim a trailing slash so `${base}/api/...` never doubles up. */
export function baseUrl(endpoint: string): string {
	return endpoint.replace(/\/+$/, '');
}
