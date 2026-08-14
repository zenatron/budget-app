import { afterEach, describe, expect, it, vi } from 'vitest';
import { getGeocoder } from './index';
import { nominatimGeocoder } from './nominatim-geocoder';

/** Typed so `mock.calls` carries the fetch arguments the assertions read. */
const OK = (rows: unknown) =>
	vi.fn(
		async (...args: [input: RequestInfo | URL, init?: RequestInit]) =>
			new Response(JSON.stringify(rows), {
				status: 200,
				headers: { 'x-args': String(args.length) }
			})
	);

const SF_ROW = { lat: '37.7749', lon: '-122.4194', display_name: 'Ferry Building, San Francisco' };

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('getGeocoder', () => {
	it('falls back to the null adapter for an incomplete config', () => {
		for (const endpoint of [null, undefined, '']) {
			const g = getGeocoder({ endpoint });
			expect(g.available).toBe(false);
			expect(g.describe().kind).toBe('off');
		}
	});

	it('answers nothing, and reaches no network, when off', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		await expect(getGeocoder({ endpoint: null }).search('Ferry Building')).resolves.toEqual([]);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('builds a real adapter from a complete config', () => {
		const g = getGeocoder({ endpoint: 'https://nominatim.example' });
		expect(g.available).toBe(true);
		expect(g.describe()).toEqual({ kind: 'nominatim', endpoint: 'https://nominatim.example' });
	});

	it('returns the same adapter for the same config', () => {
		// Not an optimisation: the adapter's one-per-second gate lives in a
		// closure, and the search endpoint calls this once per HTTP request. A
		// fresh adapter each time gave every request its own allowance, which is
		// the same as having no gate.
		const a = getGeocoder({ endpoint: 'https://memo.example', email: 'x@y.z' });
		const b = getGeocoder({ endpoint: 'https://memo.example', email: 'x@y.z' });
		expect(a).toBe(b);
		expect(getGeocoder({ endpoint: 'https://other.example' })).not.toBe(a);
	});
});

describe('nominatimGeocoder', () => {
	const make = () => nominatimGeocoder({ endpoint: 'https://nominatim.example', email: 'a@b.c' });

	it('maps rows to results', async () => {
		vi.stubGlobal('fetch', OK([SF_ROW]));
		const [hit] = await make().search('Ferry Building');
		expect(hit.label).toBe('Ferry Building, San Francisco');
		expect(hit.coords.lat).toBeCloseTo(37.7749, 6);
		expect(hit.coords.lng).toBeCloseTo(-122.4194, 6);
	});

	it('identifies itself, because anonymous clients are blocked', async () => {
		const spy = OK([SF_ROW]);
		vi.stubGlobal('fetch', spy);
		await make().search('Ferry Building');
		const headers = spy.mock.calls[0][1]?.headers as Record<string, string>;
		expect(headers['User-Agent']).toContain('a@b.c');
	});

	it('refuses to ask about text too short to be a place', async () => {
		const spy = OK([SF_ROW]);
		vi.stubGlobal('fetch', spy);
		expect(await make().search('ab')).toEqual([]);
		expect(spy).not.toHaveBeenCalled();
	});

	it('holds to one request per second, whatever the caller does', async () => {
		// The consequence of getting this wrong is the deployment's IP being
		// banned, which outlives the request that caused it — so the adapter
		// enforces it rather than trusting the caller's debounce.
		const spy = OK([SF_ROW]);
		vi.stubGlobal('fetch', spy);
		const g = make();
		await g.search('Ferry Building');
		await g.search('Union Square');
		await g.search('Golden Gate Park');
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('treats every failure as no answer, and never throws', async () => {
		const g = make();
		for (const stub of [
			vi.fn(async () => new Response('', { status: 429 })),
			vi.fn(async () => new Response('', { status: 500 })),
			vi.fn(async () => new Response('not json', { status: 200 })),
			vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 200 })),
			vi.fn(async () => {
				throw new Error('offline');
			})
		]) {
			vi.stubGlobal('fetch', stub);
			// A fresh adapter each time, so the per-second gate isn't what's returning [].
			const fresh = nominatimGeocoder({ endpoint: 'https://nominatim.example' });
			await expect(fresh.search('Ferry Building')).resolves.toEqual([]);
		}
		expect(g.available).toBe(true);
	});

	it('drops rows that are not a point on Earth', async () => {
		vi.stubGlobal(
			'fetch',
			OK([
				{ lat: '91.5', lon: '0', display_name: 'Impossible' },
				{ lat: 'not-a-number', lon: '0', display_name: 'Also impossible' },
				{ lat: '0', lon: '0', display_name: '' },
				SF_ROW
			])
		);
		const out = await make().search('anything');
		expect(out).toHaveLength(1);
		expect(out[0].label).toBe('Ferry Building, San Francisco');
	});

	it('never asks for more than a sane number of rows', async () => {
		const spy = OK([SF_ROW]);
		vi.stubGlobal('fetch', spy);
		await make().search('Ferry Building', 500);
		const url = new URL(String(spy.mock.calls[0][0]));
		expect(Number(url.searchParams.get('limit'))).toBeLessThanOrEqual(10);
	});
});
