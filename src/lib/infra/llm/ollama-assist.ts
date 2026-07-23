import type { LlmAssist } from '$lib/ports/llm-assist';
import { constrainToChoice, sanitizeLabel } from '$lib/domain/intelligence/constrain';
import { baseUrl, choiceMessages, fetchWithTimeout, labelMessages } from './prompt';

/**
 * Local assist over the Ollama HTTP API. Everything stays on the box the
 * endpoint points at — nothing leaves. Temperature is pinned to 0 for the
 * steadiest classification a small local model can give; whatever it returns is
 * still validated against the caller's option set, so a shaky model degrades to
 * "no suggestion", never to a wrong one.
 */
export function ollamaAssist(cfg: { endpoint: string; model: string }): LlmAssist {
	const base = baseUrl(cfg.endpoint);

	async function complete(messages: { role: string; content: string }[]): Promise<string | null> {
		try {
			const res = await fetchWithTimeout(`${base}/api/chat`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					model: cfg.model,
					messages,
					stream: false,
					options: { temperature: 0 }
				})
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
		}
	};
}
