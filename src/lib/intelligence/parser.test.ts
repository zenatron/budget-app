import { describe, expect, it } from 'vitest';
import { parse, understand } from './parser';

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

	it('reports what is missing instead of inventing an amount', () => {
		// 'incomplete', not 'unknown': we know it's a bucket, so the palette can
		// say which part is absent rather than shrugging at a valid attempt.
		expect(at('create a travel bucket')).toMatchObject({
			intent: 'incomplete',
			of: 'create_bucket',
			missing: ['amount']
		});
		expect(at('create a travel bucket of 500')).toMatchObject({
			intent: 'incomplete',
			missing: ['cadence']
		});
	});
});

describe('parse — create income', () => {
	it('handles the phrasing that used to fall through entirely', () => {
		expect(at('create a new income of 4800 per month every month on the first')).toEqual({
			intent: 'create_income',
			source: 'Income',
			amount: 4800,
			cadence: 'monthly',
			dayOfMonth: 1
		});
	});

	it('reads the source from "from X" and from a leading noun', () => {
		expect(at('income from freelance of 900 per month')).toMatchObject({
			source: 'Freelance',
			amount: 900,
			cadence: 'monthly'
		});
		expect(at('add a bonus income of 1200')).toMatchObject({ source: 'Bonus', cadence: 'once' });
		expect(at('new salary 3200/mo on the 15th')).toMatchObject({
			source: 'Salary',
			dayOfMonth: 15
		});
	});

	it('treats a bare amount as a one-off, not a recurring entry', () => {
		expect(at('add income of 500')).toMatchObject({ cadence: 'once' });
		expect(at('add income of 500 per month')).toMatchObject({ cadence: 'monthly' });
	});

	it('does not swallow navigation to the income page', () => {
		expect(at('go to income')).toEqual({ intent: 'navigate', target: 'income' });
	});
});

describe('understand — live feedback', () => {
	it('marks a complete command ready and lists its slots', () => {
		const u = understand('add income of 4800 per month on the first', NOW);
		expect(u.ready).toBe(true);
		expect(u.label).toBe('New income');
		expect(u.slots.map((s) => s.label)).toEqual(['Source', 'Amount', 'Repeats']);
		expect(u.suggestions).toEqual([]);
	});

	it('offers completions built from what the user already typed', () => {
		const u = understand('add income', NOW);
		expect(u.ready).toBe(false);
		expect(u.missing[0]).toMatch(/amount/);
		expect(u.suggestions.every((s) => s.startsWith('add income'))).toBe(true);
	});

	it('falls back to generic examples when nothing matched', () => {
		const u = understand('the quick brown fox', NOW);
		expect(u.ready).toBe(false);
		expect(u.suggestions.length).toBeGreaterThan(0);
	});

	it('stays quiet on an empty box', () => {
		const u = understand('', NOW);
		expect(u.label).toBe('');
		expect(u.slots).toEqual([]);
		expect(u.suggestions).toEqual([]);
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
