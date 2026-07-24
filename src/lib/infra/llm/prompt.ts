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

/** One place to bound a call — local models can be slow, but not unbounded. */
export const ASSIST_TIMEOUT_MS = 15_000;

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
