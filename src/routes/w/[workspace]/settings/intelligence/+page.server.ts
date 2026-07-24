import { error, fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '$lib/server/db';
import { workspace } from '$lib/server/db/schema';
import { getLlmAssist, type AssistConfig } from '$lib/infra/llm';
import { getEnv } from '$lib/server/env';
import type { Actions, PageServerLoad } from './$types';

const ConfigSchema = v.object({
	mode: v.picklist(['off', 'local', 'external']),
	endpoint: v.optional(v.pipe(v.string(), v.trim()), ''),
	model: v.optional(v.pipe(v.string(), v.trim()), ''),
	// Blank means "keep the existing key" so it's never echoed back to the client.
	apiKey: v.optional(v.string(), '')
});

function validateEndpoint(endpoint: string): string | null {
	try {
		const u = new URL(endpoint);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Endpoint must be http or https';
		return null;
	} catch {
		return 'Endpoint is not a valid URL';
	}
}

export const load: PageServerLoad = async ({ locals, params }) => {
	void params.workspace;
	const ws = locals.workspace!;
	const env = getEnv();
	return {
		isOwner: locals.member!.role === 'owner',
		intelligenceEnabled: ws.intelligenceEnabled,
		billImportEnabled: ws.billImportEnabled,
		barcodeEnabled: ws.barcodeEnabled,
		barcodeConfigured: !!env.BARCODE_LOOKUP_URL,
		config: {
			mode: ws.aiMode,
			endpoint: ws.aiEndpoint ?? '',
			model: ws.aiModel ?? '',
			// Never send the key itself — only whether one is stored.
			apiKeySet: !!ws.aiApiKey
		}
	};
};

/** Resolve the config a form submission describes, keeping the stored key if blank. */
function configFromForm(
	out: v.InferOutput<typeof ConfigSchema>,
	stored: { aiApiKey: string | null }
): AssistConfig {
	return {
		aiMode: out.mode,
		aiEndpoint: out.endpoint || null,
		aiModel: out.model || null,
		aiApiKey: out.apiKey ? out.apiKey : stored.aiApiKey
	};
}

export const actions: Actions = {
	save: async ({ locals, request }) => {
		if (locals.member!.role !== 'owner')
			error(403, 'Only the owner can change intelligence settings');
		const parsed = v.safeParse(ConfigSchema, Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.issues[0].message });
		const out = parsed.output;

		if (out.mode !== 'off') {
			if (!out.endpoint) return fail(400, { error: 'An endpoint URL is required' });
			const bad = validateEndpoint(out.endpoint);
			if (bad) return fail(400, { error: bad });
			if (!out.model) return fail(400, { error: 'A model name is required' });
		}

		const db = getDb();
		const cfg = configFromForm(out, { aiApiKey: locals.workspace!.aiApiKey });
		await db
			.update(workspace)
			.set({
				aiMode: cfg.aiMode,
				aiEndpoint: cfg.aiEndpoint,
				aiModel: cfg.aiModel,
				// Off clears the key so a disabled provider leaves nothing sensitive behind.
				aiApiKey: cfg.aiMode === 'off' ? null : cfg.aiApiKey
			})
			.where(eq(workspace.id, locals.workspace!.id));
		return { ok: true };
	},

	/** Ping the endpoint described by the form (unsaved), so it can be checked first. */
	test: async ({ locals, request }) => {
		if (locals.member!.role !== 'owner')
			error(403, 'Only the owner can test intelligence settings');
		const parsed = v.safeParse(ConfigSchema, Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.issues[0].message });
		const out = parsed.output;
		if (out.mode === 'off')
			return { test: { ok: false, detail: 'Turn a provider on to test it.' } };
		if (!out.endpoint || !out.model) {
			return { test: { ok: false, detail: 'Fill in the endpoint and model first.' } };
		}
		const bad = validateEndpoint(out.endpoint);
		if (bad) return fail(400, { error: bad });

		const assist = getLlmAssist(configFromForm(out, { aiApiKey: locals.workspace!.aiApiKey }));
		const result = await assist.ping();
		return { test: result };
	}
};
