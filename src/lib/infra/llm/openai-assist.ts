import type { LlmAssist } from '$lib/ports/llm-assist';
import { constrainToChoice, sanitizeLabel } from '$lib/domain/intelligence/constrain';
import {
	answerQuestionMessages,
	baseUrl,
	choiceMessages,
	fetchWithTimeout,
	type ChatMessage,
	labelMessages,
	openaiImageMessages,
	parseCommandMessages,
	parseTranscription,
	parseTranscriptionRows,
	readFieldsMessages,
	readRowsMessages,
	sanitizeAnswer,
	VISION_TIMEOUT_MS
} from './prompt';
import { parseActionJson } from './parse-action';

/**
 * External assist over any OpenAI-compatible chat API (OpenAI, Groq, Together,
 * or a local server like llama.cpp / LM Studio that speaks the same shape).
 *
 * Unlike the local adapter, this sends the text off the box, so it is only
 * reachable when an owner has explicitly chosen 'external' mode and accepted
 * that trade in the settings copy. Same guarantee otherwise: the answer is
 * constrained before it counts.
 */
export function openaiAssist(cfg: {
	endpoint: string;
	model: string;
	apiKey: string | null;
}): LlmAssist {
	const base = baseUrl(cfg.endpoint);
	const authHeaders: Record<string, string> = {
		'content-type': 'application/json',
		...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {})
	};

	async function complete(messages: { role: string; content: string }[]): Promise<string | null> {
		try {
			const res = await fetchWithTimeout(`${base}/v1/chat/completions`, {
				method: 'POST',
				headers: authHeaders,
				body: JSON.stringify({ model: cfg.model, messages, temperature: 0 })
			});
			if (!res.ok) return null;
			const data = await res.json();
			const content = data?.choices?.[0]?.message?.content;
			return typeof content === 'string' ? content : null;
		} catch {
			return null;
		}
	}

	/**
	 * Vision over the content-parts shape. No `response_format` is requested:
	 * plenty of OpenAI-compatible servers reject an unknown one outright, and
	 * `parseTranscription` already digs the object out of whatever comes back —
	 * which is the more portable place to be strict.
	 */
	async function transcribe(
		messages: ChatMessage[],
		image: { data: Uint8Array; mediaType: string }
	): Promise<string | null> {
		try {
			const res = await fetchWithTimeout(
				`${base}/v1/chat/completions`,
				{
					method: 'POST',
					headers: authHeaders,
					body: JSON.stringify({
						model: cfg.model,
						messages: openaiImageMessages(messages, image),
						temperature: 0
					})
				},
				VISION_TIMEOUT_MS
			);
			if (!res.ok) return null;
			const data = await res.json();
			const content = data?.choices?.[0]?.message?.content;
			return typeof content === 'string' ? content : null;
		} catch {
			return null;
		}
	}

	return {
		available: true,
		describe: () => ({ mode: 'external', endpoint: base, model: cfg.model }),
		async ping() {
			try {
				const res = await fetchWithTimeout(`${base}/v1/models`, { headers: authHeaders }, 5000);
				if (res.status === 401) return { ok: false, detail: 'Rejected the API key (401).' };
				if (!res.ok) return { ok: false, detail: `Endpoint responded ${res.status}` };
				return { ok: true, detail: `Reached the API for model ${cfg.model}.` };
			} catch (e) {
				return { ok: false, detail: `Could not reach ${base}: ${(e as Error).message}` };
			}
		},
		async pickChoice(req) {
			const raw = await complete(choiceMessages(req));
			return raw === null ? null : constrainToChoice(raw, req.choices);
		},
		async cleanLabel(req) {
			const raw = await complete(labelMessages(req));
			return raw === null ? null : sanitizeLabel(raw, req.maxLen);
		},
		async parseCommand({ query }) {
			const raw = await complete(parseCommandMessages(query));
			return raw === null ? null : parseActionJson(raw);
		},
		async answerQuestion({ query, briefing }) {
			const raw = await complete(answerQuestionMessages(query, briefing));
			return raw === null ? null : sanitizeAnswer(raw);
		},
		async readFields(req) {
			const raw = await transcribe(readFieldsMessages(req), req.image);
			return raw === null ? null : parseTranscription(raw);
		},
		async readRows(req) {
			const raw = await transcribe(readRowsMessages(req), req.image);
			return raw === null ? null : parseTranscriptionRows(raw, req.maxRows);
		}
	};
}
