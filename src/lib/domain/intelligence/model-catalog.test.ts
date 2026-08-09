import { describe, it, expect } from 'vitest';
import {
	hasCapability,
	mergeCatalog,
	parseShow,
	parseTags,
	staleModels,
	type ModelEntry
} from './model-catalog';

const entry = (over: Partial<ModelEntry> = {}): ModelEntry => ({
	name: 'gemma4:latest',
	modifiedAt: '2026-08-01T10:00:00Z',
	capabilities: ['completion', 'vision'],
	...over
});

const cacheOf = (...es: ModelEntry[]) => new Map(es.map((e) => [e.name, e]));

describe('parseTags', () => {
	it('reads names and stamps, sorted by name', () => {
		expect(
			parseTags({
				models: [
					{ name: 'granite4.1:8b', modified_at: '2026-07-02T00:00:00Z' },
					{ name: 'gemma4:latest', modified_at: '2026-08-01T10:00:00Z' }
				]
			})
		).toEqual([
			{ name: 'gemma4:latest', modifiedAt: '2026-08-01T10:00:00Z' },
			{ name: 'granite4.1:8b', modifiedAt: '2026-07-02T00:00:00Z' }
		]);
	});

	it('drops unnamed rows rather than inventing a name', () => {
		expect(parseTags({ models: [{ size: 12 }, { name: '' }] })).toEqual([]);
	});

	it('survives a body that is not a listing at all', () => {
		expect(parseTags(null)).toEqual([]);
		expect(parseTags({ models: 'nope' })).toEqual([]);
	});

	it('tolerates a missing stamp, which then always reads as stale', () => {
		const tags = parseTags({ models: [{ name: 'x' }] });
		expect(tags).toEqual([{ name: 'x', modifiedAt: '' }]);
	});
});

describe('parseShow', () => {
	it('keeps capabilities and the cosmetic details, drops the bulk', () => {
		expect(
			parseShow({
				capabilities: ['completion', 'vision', 'tools'],
				details: { parameter_size: '8.0B', quantization_level: 'Q4_K_M', family: 'gemma4' },
				modelfile: 'x'.repeat(50_000),
				tensors: new Array(400).fill({ name: 'blk' })
			})
		).toEqual({
			capabilities: ['completion', 'vision', 'tools'],
			parameterSize: '8.0B',
			quantization: 'Q4_K_M'
		});
	});

	it('reports null — not empty — when the server never mentions capabilities', () => {
		// An older Ollama. Empty would claim the model can do nothing.
		expect(parseShow({ details: {} }).capabilities).toBeNull();
	});

	it('reports empty when the server genuinely says empty', () => {
		expect(parseShow({ capabilities: [] }).capabilities).toEqual([]);
	});

	it('discards non-string capability entries', () => {
		expect(parseShow({ capabilities: ['vision', 7, null] }).capabilities).toEqual(['vision']);
	});
});

describe('staleModels', () => {
	it('asks about models it has never seen', () => {
		expect(staleModels([{ name: 'new:1', modifiedAt: 'a' }], cacheOf())).toEqual(['new:1']);
	});

	it('asks again when the stamp moved — a re-pull invalidates itself', () => {
		const cached = cacheOf(entry({ modifiedAt: 'old' }));
		expect(staleModels([{ name: 'gemma4:latest', modifiedAt: 'new' }], cached)).toEqual([
			'gemma4:latest'
		]);
	});

	it('asks nothing when the stamp matches — the usual refresh costs one request', () => {
		const cached = cacheOf(entry());
		expect(
			staleModels([{ name: 'gemma4:latest', modifiedAt: entry().modifiedAt }], cached)
		).toEqual([]);
	});

	it('retries a model whose capabilities were never established', () => {
		// So a server upgraded into capability support fills in, instead of
		// staying blank until something happens to change its stamp.
		const cached = cacheOf(entry({ capabilities: null }));
		expect(
			staleModels([{ name: 'gemma4:latest', modifiedAt: entry().modifiedAt }], cached)
		).toEqual(['gemma4:latest']);
	});

	it('does not retry one that reported genuinely empty capabilities', () => {
		const cached = cacheOf(entry({ capabilities: [] }));
		expect(
			staleModels([{ name: 'gemma4:latest', modifiedAt: entry().modifiedAt }], cached)
		).toEqual([]);
	});
});

describe('mergeCatalog', () => {
	it('carries cached capabilities onto the live listing', () => {
		const out = mergeCatalog(
			[{ name: 'gemma4:latest', modifiedAt: entry().modifiedAt }],
			cacheOf(entry())
		);
		expect(out[0].capabilities).toEqual(['completion', 'vision']);
	});

	it('drops a model that has left the server, even though it is cached', () => {
		expect(mergeCatalog([], cacheOf(entry()))).toEqual([]);
	});

	it('blanks capabilities when the stamp moved, rather than showing the old ones', () => {
		const out = mergeCatalog([{ name: 'gemma4:latest', modifiedAt: 'moved' }], cacheOf(entry()));
		expect(out[0].capabilities).toBeNull();
	});
});

describe('hasCapability', () => {
	it('is false when capabilities were never established', () => {
		// The load-bearing case: unknown must never render as a claim either way.
		expect(hasCapability(entry({ capabilities: null }), 'vision')).toBe(false);
	});

	it('is true only on a positive claim', () => {
		expect(hasCapability(entry(), 'vision')).toBe(true);
		expect(hasCapability(entry(), 'audio')).toBe(false);
	});
});
