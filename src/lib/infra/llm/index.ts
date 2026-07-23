import type { LlmAssist } from '$lib/ports/llm-assist';
import { nullAssist } from './null-assist';
import { ollamaAssist } from './ollama-assist';
import { openaiAssist } from './openai-assist';

export interface AssistConfig {
	aiMode: 'off' | 'local' | 'external';
	aiEndpoint: string | null;
	aiModel: string | null;
	aiApiKey: string | null;
}

/**
 * Build the assist for a workspace's config. Anything short of a complete,
 * enabled config resolves to the null adapter, so a half-filled form or a
 * flipped-off switch can never leave a caller talking to a broken endpoint —
 * it just falls back to deterministic behaviour.
 */
export function getLlmAssist(cfg: AssistConfig): LlmAssist {
	if (cfg.aiMode === 'off') return nullAssist;
	if (!cfg.aiEndpoint || !cfg.aiModel) return nullAssist;
	if (cfg.aiMode === 'local') {
		return ollamaAssist({ endpoint: cfg.aiEndpoint, model: cfg.aiModel });
	}
	return openaiAssist({
		endpoint: cfg.aiEndpoint,
		model: cfg.aiModel,
		apiKey: cfg.aiApiKey
	});
}

export { nullAssist };
