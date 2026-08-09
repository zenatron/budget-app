import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { listModels, forgetCatalog } from './model-catalog';

/**
 * These assert request *counts*, which is the whole claim the cache makes:
 * listing is one call, and /api/show is paid only for models that are new or
 * have moved. Timing can't show this against a local Ollama — /api/show answers
 * in about four milliseconds, well under the noise of anything else.
 */

const TAGS = (stamps: Record<string, string>) => ({
	models: Object.entries(stamps).map(([name, modified_at]) => ({ name, modified_at }))
});

const SHOW = (caps: string[] | null) => ({
	...(caps ? { capabilities: caps } : {}),
	details: { parameter_size: '8.0B', quantization_level: 'Q4_K_M' }
});

let calls: string[];
const base = 'http://ollama.test';

function install(handler: (url: string, body: unknown) => unknown) {
	vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
		calls.push(url);
		const body = init?.body ? JSON.parse(init.body as string) : undefined;
		return { ok: true, json: async () => handler(url, body) } as Response;
	});
}

const showCount = () => calls.filter((u) => u.endsWith('/api/show')).length;
const tagCount = () => calls.filter((u) => u.endsWith('/api/tags')).length;

beforeEach(() => {
	calls = [];
	forgetCatalog(base);
});
afterEach(() => vi.unstubAllGlobals());

describe('listModels', () => {
	it('pays for /api/show once, then never again while nothing moves', async () => {
		install((url) =>
			url.endsWith('/api/tags') ? TAGS({ a: 's1', b: 's1' }) : SHOW(['completion', 'vision'])
		);

		const first = await listModels(base);
		expect(tagCount()).toBe(1);
		expect(showCount()).toBe(2);
		expect(first.models.map((m) => m.capabilities)).toEqual([
			['completion', 'vision'],
			['completion', 'vision']
		]);

		calls = [];
		const second = await listModels(base);
		expect(tagCount()).toBe(1);
		expect(showCount()).toBe(0); // the point of the whole exercise
		expect(second.models[0].capabilities).toEqual(['completion', 'vision']);
	});

	it('re-asks only about the model whose stamp moved', async () => {
		let stamps = { a: 's1', b: 's1' };
		install((url) => (url.endsWith('/api/tags') ? TAGS(stamps) : SHOW(['completion'])));
		await listModels(base);

		stamps = { a: 's1', b: 's2' }; // b was re-pulled
		calls = [];
		await listModels(base);
		expect(showCount()).toBe(1);
	});

	it('refresh re-establishes everything', async () => {
		install((url) => (url.endsWith('/api/tags') ? TAGS({ a: 's1', b: 's1' }) : SHOW(['tools'])));
		await listModels(base);
		calls = [];
		await listModels(base, { refresh: true });
		expect(showCount()).toBe(2);
	});

	it('drops a model that has left the server', async () => {
		let stamps: Record<string, string> = { a: 's1', b: 's1' };
		install((url) => (url.endsWith('/api/tags') ? TAGS(stamps) : SHOW(['completion'])));
		await listModels(base);

		stamps = { a: 's1' };
		const after = await listModels(base);
		expect(after.models.map((m) => m.name)).toEqual(['a']);
	});

	it('keeps listing when a capability lookup fails, leaving it unknown', async () => {
		vi.stubGlobal('fetch', async (url: string) => {
			calls.push(url);
			if (url.endsWith('/api/tags'))
				return { ok: true, json: async () => TAGS({ a: 's1' }) } as Response;
			return { ok: false, status: 500, json: async () => ({}) } as Response;
		});
		const out = await listModels(base);
		expect(out.models[0].capabilities).toBeNull();
		expect(out.capabilitiesUnavailable).toBe(true);
	});

	it('flags an Ollama too old to report capabilities', async () => {
		install((url) => (url.endsWith('/api/tags') ? TAGS({ a: 's1' }) : SHOW(null)));
		const out = await listModels(base);
		expect(out.models[0].capabilities).toBeNull();
		expect(out.capabilitiesUnavailable).toBe(true);
	});

	it('does not flag when at least one model reported capabilities', async () => {
		install((url) =>
			url.endsWith('/api/tags') ? TAGS({ a: 's1', b: 's1' }) : SHOW(['completion'])
		);
		const out = await listModels(base);
		expect(out.capabilitiesUnavailable).toBe(false);
	});

	it('throws when the listing itself fails — that is a real connection error', async () => {
		vi.stubGlobal(
			'fetch',
			async () => ({ ok: false, status: 502, json: async () => ({}) }) as Response
		);
		await expect(listModels(base)).rejects.toThrow(/502/);
	});
});
