import { describe, expect, it } from 'vitest';
import { narrateMonth, summarizeMonth, type MonthStatementFigures } from './month-statement';

const fmt = (m: bigint) => {
	const neg = m < 0n;
	const abs = neg ? -m : m;
	const s = `$${(Number(abs) / 100).toFixed(2)}`;
	return neg ? `-${s}` : s;
};

const base: MonthStatementFigures = {
	spentMinor: 0n,
	prevSpentMinor: 0n,
	incomeMinor: 0n,
	savingsMinor: 0n,
	txCount: 0,
	topCategory: null,
	biggestDay: null,
	budget: null,
	isPartial: false
};

describe('summarizeMonth', () => {
	it('nets income minus spend minus savings', () => {
		const s = summarizeMonth({
			...base,
			incomeMinor: 500_000n,
			spentMinor: 300_000n,
			savingsMinor: 50_000n
		});
		expect(s.netMinor).toBe(150_000n);
		expect(s.status).toBe('saved');
	});

	it('is over when net goes negative', () => {
		const s = summarizeMonth({ ...base, incomeMinor: 100_000n, spentMinor: 150_000n });
		expect(s.netMinor).toBe(-50_000n);
		expect(s.status).toBe('over');
	});

	it('is even at exactly zero net', () => {
		const s = summarizeMonth({ ...base, incomeMinor: 100_000n, spentMinor: 100_000n });
		expect(s.status).toBe('even');
	});

	it('is neutral when no income is tracked, however much was spent', () => {
		const s = summarizeMonth({ ...base, spentMinor: 999_999n });
		expect(s.status).toBe('neutral');
		expect(s.savingsRateBps).toBeNull();
	});

	it('computes savings rate in basis points', () => {
		const s = summarizeMonth({ ...base, incomeMinor: 400_000n, savingsMinor: 100_000n });
		expect(s.savingsRateBps).toBe(2500); // 25%
	});

	it('gives a null month-over-month percent when last month was empty', () => {
		const s = summarizeMonth({ ...base, spentMinor: 100_000n, prevSpentMinor: 0n });
		expect(s.momDeltaPct).toBeNull();
		expect(s.momDeltaMinor).toBe(100_000n);
	});

	it('reports budget variance, positive means room to spare', () => {
		const s = summarizeMonth({
			...base,
			budget: { limitMinor: 300_000n, actualMinor: 250_000n }
		});
		expect(s.budgetVarianceMinor).toBe(50_000n);
	});
});

describe('narrateMonth', () => {
	it('judges nothing when income is untracked', () => {
		const n = narrateMonth({ ...base, spentMinor: 120_000n, txCount: 8 }, fmt);
		expect(n.tone).toBe('neutral');
		expect(n.lead).toContain('$1200.00');
		expect(n.lead).toContain('8 purchases');
		// Never claims a balance it can't see.
		expect(n.lead).not.toMatch(/ahead|behind|even/);
	});

	it('names a clean page when nothing was spent and nothing came in', () => {
		const n = narrateMonth(base, fmt);
		expect(n.lead).toContain('clean page');
	});

	it('leads with the shortfall when over', () => {
		const n = narrateMonth({ ...base, incomeMinor: 100_000n, spentMinor: 150_000n }, fmt);
		expect(n.tone).toBe('over');
		expect(n.lead).toContain('$500.00 behind');
	});

	it('celebrates a surplus when saved', () => {
		const n = narrateMonth(
			{ ...base, incomeMinor: 500_000n, spentMinor: 300_000n, savingsMinor: 50_000n },
			fmt
		);
		expect(n.tone).toBe('saved');
		expect(n.lead).toContain('$1500.00 ahead');
		expect(n.lead).toContain('set aside $500.00');
	});

	it('hedges tense and claim for a partial month', () => {
		const n = narrateMonth(
			{ ...base, incomeMinor: 500_000n, spentMinor: 100_000n, isPartial: true },
			fmt
		);
		expect(n.lead).toContain('ahead so far');
		expect(n.lead).not.toContain('closed');
	});

	it('adds a top-category note and flags a dominant share', () => {
		const n = narrateMonth(
			{
				...base,
				spentMinor: 100_000n,
				topCategory: { name: 'Groceries', totalMinor: 60_000n }
			},
			fmt
		);
		const note = n.notes.find((x) => x.includes('Groceries'));
		expect(note).toBeDefined();
		expect(note).toContain('60% of everything');
	});

	it('describes the month-over-month move both ways', () => {
		const up = narrateMonth({ ...base, spentMinor: 120_000n, prevSpentMinor: 100_000n }, fmt);
		expect(up.notes.some((x) => x.includes('more than last month') && x.includes('20%'))).toBe(
			true
		);
		const down = narrateMonth({ ...base, spentMinor: 80_000n, prevSpentMinor: 100_000n }, fmt);
		expect(down.notes.some((x) => x.includes('less than last month') && x.includes('20%'))).toBe(
			true
		);
	});

	it('calls a small change roughly level', () => {
		const n = narrateMonth({ ...base, spentMinor: 102_000n, prevSpentMinor: 100_000n }, fmt);
		expect(n.notes.some((x) => x.includes('roughly level'))).toBe(true);
	});

	it('reports whether the plan held or broke', () => {
		const held = narrateMonth(
			{ ...base, spentMinor: 250_000n, budget: { limitMinor: 300_000n, actualMinor: 250_000n } },
			fmt
		);
		expect(held.notes.some((x) => x.includes('plan held') && x.includes('$500.00 to spare'))).toBe(
			true
		);
		const broke = narrateMonth(
			{ ...base, spentMinor: 350_000n, budget: { limitMinor: 300_000n, actualMinor: 350_000n } },
			fmt
		);
		expect(broke.notes.some((x) => x.includes('$500.00 past your'))).toBe(true);
	});

	it('never emits an em dash in its prose', () => {
		const n = narrateMonth(
			{
				...base,
				incomeMinor: 500_000n,
				spentMinor: 300_000n,
				savingsMinor: 50_000n,
				prevSpentMinor: 200_000n,
				topCategory: { name: 'Rent', totalMinor: 200_000n },
				budget: { limitMinor: 320_000n, actualMinor: 300_000n }
			},
			fmt
		);
		const all = [n.lead, ...n.notes].join(' ');
		expect(all).not.toContain('—');
	});
});
