import {
	mergeCatalog,
	parseShow,
	parseTags,
	staleModels,
	type ModelEntry
} from '$lib/domain/intelligence/model-catalog';
import { fetchWithTimeout } from './prompt';

/**
 * Lists a local Ollama's models with their capabilities, cached per endpoint.
 *
 * The cache is a plain module-level Map: this is derived, non-authoritative
 * data about a server the user controls, cheap to rebuild and worthless to
 * persist. It dies with the process and refills on the next look, which is the
 * correct lifetime for "what does that box have installed right now".
 *
 * Cost per refresh is one /api/tags plus one /api/show for each model that is
 * new or has moved — usually zero. See the domain module for why `modified_at`
 * is the validator.
 */

const cache = new Map<string, Map<string, ModelEntry>>();

/** How many /api/show calls to have in flight at once against a local box. */
const CONCURRENCY = 4;

export interface Catalog {
	models: ModelEntry[];
	/** True when the server answered but told us nothing about capabilities. */
	capabilitiesUnavailable: boolean;
}

function entriesFor(base: string): Map<string, ModelEntry> {
	let m = cache.get(base);
	if (!m) {
		m = new Map();
		cache.set(base, m);
	}
	return m;
}

/** Drop what we know about an endpoint, so the next list re-establishes it. */
export function forgetCatalog(base: string): void {
	cache.delete(base);
}

async function showModel(base: string, name: string): Promise<Partial<ModelEntry>> {
	try {
		const res = await fetchWithTimeout(
			`${base}/api/show`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json', Accept: 'application/json' },
				body: JSON.stringify({ model: name })
			},
			8000
		);
		if (!res.ok) return { capabilities: null };
		return parseShow(await res.json());
	} catch {
		// One model failing to introspect must not sink the whole listing — it
		// just stays "not known", which renders as no chips.
		return { capabilities: null };
	}
}

/** Run `work` over `items`, a few at a time, preserving nothing but effects. */
async function pooled<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
	let i = 0;
	const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (i < items.length) {
			const item = items[i++];
			await work(item);
		}
	});
	await Promise.all(runners);
}

/**
 * The catalog for `base`. Throws only if the listing itself fails — capability
 * lookups degrade to "not known" rather than failing the call, because a model
 * list with no chips is still a usable model list.
 */
export async function listModels(base: string, opts: { refresh?: boolean } = {}): Promise<Catalog> {
	if (opts.refresh) forgetCatalog(base);

	const res = await fetchWithTimeout(
		`${base}/api/tags`,
		{ headers: { Accept: 'application/json' } },
		8000
	);
	if (!res.ok) throw new Error(`Could not list models (${res.status}).`);
	const tags = parseTags(await res.json());

	const known = entriesFor(base);
	const wanted = staleModels(tags, known);

	await pooled(wanted, CONCURRENCY, async (name) => {
		const tag = tags.find((t) => t.name === name)!;
		const detail = await showModel(base, name);
		known.set(name, {
			name,
			modifiedAt: tag.modifiedAt,
			capabilities: detail.capabilities ?? null,
			parameterSize: detail.parameterSize,
			quantization: detail.quantization
		});
	});

	// Forget models that have left the server, so the cache can't grow forever
	// across re-pulls and renames.
	const live = new Set(tags.map((t) => t.name));
	for (const name of known.keys()) if (!live.has(name)) known.delete(name);

	const models = mergeCatalog(tags, known);
	return {
		models,
		capabilitiesUnavailable: models.length > 0 && models.every((m) => m.capabilities === null)
	};
}
