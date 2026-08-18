import { describe, it, expect } from 'vitest';
import { parseRRule } from '$lib/domain/recurrence/rrule';
import { projectRunway, nextMonthStart, type ProjectionInputs } from './runway';

const monthly = (day: number) => parseRRule(`DTSTART=2026-01-01;FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=${day}`);
const JUL = { y: 2026, m: 7, d: 1 };

const base: ProjectionInputs = {
	incomeRules: [{ rec: monthly(1), amountMinor: 500_000n }], // $5,000/mo on the 1st
	billRules: [{ rec: monthly(5), amountMinor: 200_000n }], //   $2,000/mo on the 5th
	savingRules: [{ rec: monthly(15), amountMinor: 50_000n }], //   $500/mo on the 15th
	oneOffIncome: []
};

describe('projectRunway', () => {
	it('projects free cash per month from the recurring facts', () => {
		const r = projectRunway(base, JUL, 3);
		expect(r.months).toHaveLength(3);
		for (const m of r.months) {
			expect(m.incomeMinor).toBe(500_000n);
			expect(m.billsMinor).toBe(200_000n);
			expect(m.savingsMinor).toBe(50_000n);
			expect(m.freeMinor).toBe(250_000n); // 5000 - 2000 - 500
		}
		expect(r.clearMonths).toBe(3);
		expect(r.firstShortMonth).toBeNull();
		// Months walk forward correctly across the horizon.
		expect(r.months.map((m) => `${m.month.y}-${m.month.m}`)).toEqual(['2026-7', '2026-8', '2026-9']);
	});

	it('adds one-off income only to the month it lands in', () => {
		const r = projectRunway(
			{ ...base, oneOffIncome: [{ on: { y: 2026, m: 8, d: 20 }, amountMinor: 100_000n }] },
			JUL,
			3
		);
		expect(r.months[0].freeMinor).toBe(250_000n); // Jul unchanged
		expect(r.months[1].freeMinor).toBe(350_000n); // Aug +$1,000 bonus
		expect(r.months[2].freeMinor).toBe(250_000n); // Sep unchanged
	});

	it('flags the first short month and counts the clear months before it', () => {
		// A big annual bill lands in September.
		const annual = parseRRule('DTSTART=2026-09-10;FREQ=YEARLY');
		const r = projectRunway(
			{ ...base, billRules: [...base.billRules, { rec: annual, amountMinor: 900_000n }] },
			JUL,
			4
		);
		expect(r.months[0].freeMinor).toBe(250_000n); // Jul clear
		expect(r.months[1].freeMinor).toBe(250_000n); // Aug clear
		expect(r.months[2].freeMinor).toBe(-650_000n); // Sep short (extra $9,000 bill)
		expect(r.clearMonths).toBe(2);
		expect(r.firstShortMonth).toEqual({ y: 2026, m: 9, d: 1 });
	});

	it('handles an empty picture as all-zero and all-clear', () => {
		const r = projectRunway(
			{ incomeRules: [], billRules: [], savingRules: [], oneOffIncome: [] },
			JUL,
			2
		);
		expect(r.months.every((m) => m.freeMinor === 0n)).toBe(true);
		expect(r.clearMonths).toBe(2);
		expect(r.firstShortMonth).toBeNull();
	});

	it('rolls the year boundary', () => {
		expect(nextMonthStart({ y: 2026, m: 12, d: 1 })).toEqual({ y: 2027, m: 1, d: 1 });
		const r = projectRunway(base, { y: 2026, m: 11, d: 1 }, 3);
		expect(r.months.map((m) => `${m.month.y}-${m.month.m}`)).toEqual(['2026-11', '2026-12', '2027-1']);
	});
});
