import type { LlmAssist } from '$lib/ports/llm-assist';
import { constrainToChoice, sanitizeLabel } from '$lib/domain/intelligence/constrain';
import {
	answerQuestionMessages,
	baseUrl,
	choiceMessages,
	fetchWithTimeout,
	type ChatMessage,
	labelMessages,
	ollamaImageMessages,
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
 * Local assist over the Ollama HTTP API. Everything stays on the box the
 * endpoint points at — nothing leaves. Temperature is pinned to 0 for the
 * steadiest classification a small local model can give; whatever it returns is
 * still validated against the caller's option set, so a shaky model degrades to
 * "no suggestion", never to a wrong one.
 */
export function ollamaAssist(cfg: { endpoint: string; model: string }): LlmAssist {
	const base = baseUrl(cfg.endpoint);

	async function complete(
		messages: { role: string; content: string }[],
		formatJson = false
	): Promise<string | null> {
		try {
			const body: Record<string, unknown> = {
				model: cfg.model,
				messages,
				stream: false,
				options: { temperature: 0 }
			};
			if (formatJson) body.format = 'json';
			const res = await fetchWithTimeout(`${base}/api/chat`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) return null;
			const data = await res.json();
			const content = data?.message?.content;
			return typeof content === 'string' ? content : null;
		} catch {
			// Off, offline, timeout, malformed — the caller falls back deterministically.
			return null;
		}
	}

	/**
	 * Vision goes through its own request rather than `complete`: the image rides
	 * on the message as base64, `format: 'json'` is always on, and the bound is
	 * the longer one — a 2000px page on a local box is not a 15-second job.
	 */
	async function transcribe(
		messages: ChatMessage[],
		image: { data: Uint8Array; mediaType: string }
	): Promise<string | null> {
		try {
			const res = await fetchWithTimeout(
				`${base}/api/chat`,
				{
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({
						model: cfg.model,
						messages: ollamaImageMessages(messages, image),
						stream: false,
						format: 'json',
						options: { temperature: 0 }
					})
				},
				VISION_TIMEOUT_MS
			);
			if (!res.ok) return null;
			const data = await res.json();
			const content = data?.message?.content;
			return typeof content === 'string' ? content : null;
		} catch {
			return null;
		}
	}

	return {
		available: true,
		describe: () => ({ mode: 'local', endpoint: base, model: cfg.model }),
		async ping() {
			try {
				const res = await fetchWithTimeout(`${base}/api/tags`, { method: 'GET' }, 5000);
				if (!res.ok) return { ok: false, detail: `Endpoint responded ${res.status}` };
				const data = await res.json();
				const models: string[] = (data?.models ?? []).map((m: { name: string }) => m.name);
				const has = models.some((m) => m === cfg.model || m.startsWith(`${cfg.model}:`));
				return has
					? { ok: true, detail: `Reached Ollama, model ${cfg.model} is present.` }
					: { ok: true, detail: `Reached Ollama, but ${cfg.model} is not pulled yet.` };
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
			const raw = await complete(parseCommandMessages(query), true);
			return raw === null ? null : parseActionJson(raw);
		},
		async answerQuestion({ query, briefing }) {
			// Plain prose, not JSON — narration wants sentences, not a schema.
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
