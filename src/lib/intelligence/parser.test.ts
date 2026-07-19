import { describe, expect, it } from 'vitest';
import { parse } from './parser';

// Pinned so relative periods ("last month") resolve deterministically.
const NOW = new Date('2026-07-18T12:00:00Z');
const at = (q: string) => parse(q, NOW);

describe('parse — navigation', () => {
	it('routes explicit navigation phrasings', () => {
		expect(at('go to buckets')).toEqual({ intent: 'navigate', target: 'buckets' });
		expect(at('show me analytics')).toEqual({ intent: 'navigate', target: 'analytics' });
		expect(at('open settings')).toEqual({ intent: 'navigate', target: 'settings' });
	});

	it('accepts a bare target word and its synonyms', () => {
		expect(at('wallet')).toEqual({ intent: 'navigate', target: 'purchases' });
		expect(at('subscriptions')).toEqual({ intent: 'navigate', target: 'recurring' });
		expect(at('activity')).toEqual({ intent: 'navigate', target: 'analytics' });
	});
});

describe('parse — spending queries', () => {
	it('extracts a category', () => {
		const r = at('how much did i spend on groceries last month');
		expect(r.intent).toBe('spending_query');
		if (r.intent !== 'spending_query') return;
		expect(r.category).toBe('groceries');
		expect(r.period).toMatchObject({ type: 'month', month: 6, year: 2026 });
	});

	it('defaults to the current month when no period is named', () => {
		const r = at('how much did i spend');
		expect(r.intent).toBe('spending_query');
		if (r.intent !== 'spending_query') return;
		expect(r.period).toMatchObject({ type: 'month', month: 7, year: 2026, label: 'this month' });
	});
});

describe('parse — period resolution', () => {
	const periodOf = (q: string) => {
		const r = at(`how much did i spend ${q}`);
		if (r.intent !== 'spending_query' && r.intent !== 'net_position') throw new Error(r.intent);
		return r.period;
	};

	it('resolves this/last month across the year boundary', () => {
		expect(periodOf('this month')).toMatchObject({ month: 7, year: 2026 });
		expect(periodOf('last month')).toMatchObject({ month: 6, year: 2026 });
		expect(parse('spend last month', new Date('2026-01-09T00:00:00Z'))).toMatchObject({
			period: { month: 12, year: 2025 }
		});
	});

	it('resolves this/last year', () => {
		expect(periodOf('this year')).toMatchObject({ type: 'year', year: 2026 });
		expect(periodOf('last year')).toMatchObject({ type: 'year', year: 2025 });
	});

	it('reads an explicit month + year', () => {
		expect(periodOf('in march 2024')).toMatchObject({ type: 'month', month: 3, year: 2024 });
	});

	it('treats a bare future month as the most recent past one', () => {
		// December hasn't happened yet in July 2026, so it means December 2025.
		expect(periodOf('in december')).toMatchObject({ month: 12, year: 2025 });
		expect(periodOf('in march')).toMatchObject({ month: 3, year: 2026 });
	});

	it('"last <month>" always looks back a year when that month is ahead', () => {
		expect(periodOf('last december')).toMatchObject({ month: 12, year: 2025 });
	});
});

describe('parse — net position', () => {
	it('recognizes its phrasings and carries a period', () => {
		for (const q of ["what's my net", 'savings rate', 'how much am i saving this year']) {
			expect(at(q).intent).toBe('net_position');
		}
		const r = at('savings rate last month');
		if (r.intent !== 'net_position') throw new Error('expected net_position');
		expect(r.period).toMatchObject({ month: 6, year: 2026 });
	});
});

describe('parse — create bucket', () => {
	it('extracts name, monthly amount, and day', () => {
		const r = at('create a travel bucket of 500/mo on the 15th');
		expect(r).toEqual({
			intent: 'create_bucket',
			name: 'travel',
			amount: 500,
			dayOfMonth: 15
		});
	});

	it('does not mistake the amount for the day', () => {
		// Regression: the day pattern used to match the first number anywhere,
		// so "500/mo" won and the requested day was dropped.
		expect(at('create a travel bucket of 500/mo on the 3rd')).toMatchObject({ dayOfMonth: 3 });
		expect(at('create a car bucket of 300/mo every 20th')).toMatchObject({ dayOfMonth: 20 });
		expect(at('create a gifts bucket of 75/mo')).toMatchObject({ dayOfMonth: 1 });
	});

	it('understands first/last day', () => {
		expect(at('create a rent bucket of 1200/mo on the last day')).toMatchObject({
			dayOfMonth: -1
		});
		expect(at('create a rent bucket of 1200/mo on the first day')).toMatchObject({
			dayOfMonth: 1
		});
	});

	it('accepts other monthly phrasings and defaults the day to the 1st', () => {
		expect(at('create a rainy day bucket of $250 per month')).toMatchObject({
			intent: 'create_bucket',
			amount: 250,
			dayOfMonth: 1
		});
	});

	it('refuses a bucket with no monthly amount rather than inventing one', () => {
		expect(at('create a travel bucket').intent).toBe('unknown');
		expect(at('create a travel bucket of 500').intent).toBe('unknown');
	});
});

describe('parse — unknown', () => {
	it('returns the raw input for empty text', () => {
		expect(parse('', NOW)).toEqual({ intent: 'unknown', raw: '' });
		expect(at('the quick brown fox').intent).toBe('unknown');
	});

	it('treats any question word as a spending question, by design', () => {
		// The spending branch is the catch-all: "what"/"how much" wins even when
		// the rest of the sentence is nonsense. The endpoint answers with a total
		// rather than an error, which beats a dead end for a household tool.
		expect(at('what is the airspeed velocity of an unladen swallow').intent).toBe('spending_query');
	});
});
