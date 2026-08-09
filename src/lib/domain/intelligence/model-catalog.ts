/**
 * What a local Ollama offers, reduced to the little the settings screen needs.
 *
 * Pure: the fetching and the cache live in infra. This module owns two
 * decisions worth stating.
 *
 * **`modified_at` is the cache validator, not a clock.** `/api/tags` lists every
 * model in one request and stamps each with when it was last written;
 * `/api/show` costs a request *per model*. So a refresh re-lists (one request)
 * and only asks about models that are new or whose stamp moved. Re-pull a model
 * and it invalidates itself; leave the box alone and a refresh costs nothing
 * beyond the listing. A time-to-live would be both wronger — it can serve stale
 * capabilities for a freshly pulled model — and busier.
 *
 * **Absent is not empty.** Ollama only began reporting `capabilities` in
 * 0.6-era builds. An older server, or a model it can't introspect, yields
 * `null` — meaning "not known" — which the UI must render as nothing at all. An
 * empty array would be a claim: "this model does nothing", and would show a
 * vision-capable model as incapable. The distinction is the whole reason this
 * is `string[] | null` rather than `string[]`.
 */

/** The capabilities we recognise. Anything else is passed through untouched. */
export const KNOWN_CAPABILITIES = [
	'completion',
	'vision',
	'audio',
	'tools',
	'thinking',
	'embedding',
	'insert'
] as const;

export interface ModelEntry {
	name: string;
	/** ISO stamp from /api/tags; the validator this module caches against. */
	modifiedAt: string;
	/** null = never established. Empty array = established and genuinely none. */
	capabilities: string[] | null;
	/** Cosmetic detail from /api/show, absent until capabilities are fetched. */
	parameterSize?: string;
	quantization?: string;
}

/** A tag row as /api/tags gives it, narrowed to what we use. */
export interface TagRow {
	name: string;
	modifiedAt: string;
}

/**
 * Read the model list out of a raw /api/tags body, tolerating the shapes older
 * and newer servers use. Unnamed entries are dropped rather than guessed at.
 */
export function parseTags(body: unknown): TagRow[] {
	const models = (body as { models?: unknown })?.models;
	if (!Array.isArray(models)) return [];
	const rows: TagRow[] = [];
	for (const m of models) {
		const name = (m as { name?: unknown })?.name;
		if (typeof name !== 'string' || name.length === 0) continue;
		const stamp = (m as { modified_at?: unknown })?.modified_at;
		rows.push({ name, modifiedAt: typeof stamp === 'string' ? stamp : '' });
	}
	return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Pull the few fields worth keeping out of a raw /api/show body.
 *
 * The response also carries the modelfile, template, licence and tensor list —
 * hundreds of kilobytes that would otherwise sit in a cache forever. Everything
 * not named here is dropped at this boundary and never stored.
 */
export function parseShow(body: unknown): {
	capabilities: string[] | null;
	parameterSize?: string;
	quantization?: string;
} {
	const caps = (body as { capabilities?: unknown })?.capabilities;
	const details = (body as { details?: Record<string, unknown> })?.details ?? {};
	const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);
	return {
		capabilities: Array.isArray(caps)
			? caps.filter((c): c is string => typeof c === 'string')
			: null,
		parameterSize: str(details.parameter_size),
		quantization: str(details.quantization_level)
	};
}

/**
 * Which of `tags` still need an /api/show call, given what's already cached.
 * A model qualifies when it's unseen, when its stamp has moved, or when a
 * previous attempt never established capabilities — the last so a server
 * upgraded into capability support fills in on the next refresh instead of
 * staying blank forever.
 */
export function staleModels(tags: TagRow[], cached: Map<string, ModelEntry>): string[] {
	return tags
		.filter((t) => {
			const hit = cached.get(t.name);
			return !hit || hit.modifiedAt !== t.modifiedAt || hit.capabilities === null;
		})
		.map((t) => t.name);
}

/**
 * The catalog to show: every currently-listed model, carrying cached
 * capabilities where we have them. Models that have left the server drop out
 * even if still cached, so the list never offers something that isn't there.
 */
export function mergeCatalog(tags: TagRow[], cached: Map<string, ModelEntry>): ModelEntry[] {
	return tags.map((t) => {
		const hit = cached.get(t.name);
		if (hit && hit.modifiedAt === t.modifiedAt) return { ...hit, name: t.name };
		return { name: t.name, modifiedAt: t.modifiedAt, capabilities: null };
	});
}

/** Does this entry positively claim `cap`? Unknown capabilities never claim. */
export function hasCapability(entry: ModelEntry, cap: string): boolean {
	return entry.capabilities?.includes(cap) ?? false;
}
