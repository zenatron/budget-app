import type { LlmAssist } from '$lib/ports/llm-assist';

/**
 * The default. Every install runs with this until an owner turns the layer on,
 * and every code path stays correct with it in place — pickChoice and cleanLabel
 * just return null, so callers use the deterministic result they already had.
 */
export const nullAssist: LlmAssist = {
	available: false,
	describe: () => ({ mode: 'off', endpoint: null, model: null }),
	ping: async () => ({
		ok: false,
		detail: 'AI assist is off. Harmony uses deterministic parsing.'
	}),
	pickChoice: async () => null,
	cleanLabel: async () => null,
	parseCommand: async () => null
};
