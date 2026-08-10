import { describe, it, expect } from 'vitest';
import { buildMonth, type CalendarInput, type ScheduledSource, type DatedSource } from './month';

const scheduled = (over: Partial<ScheduledSource> = {}): ScheduledSource => ({
	kind: 'bill',
	sourceId: 'r-1',
	label: 'Rent',
	amountMinor: 145000n,
	direction: 'out',
	rrule: 'DTSTART=2025-01-01;FREQ=MONTHLY;BYMONTHDAY=1',
	estimate: false,
	...over
});

const dated = (over: Partial<DatedSource> = {}): DatedSource => ({
	kind: 'decision',
	sourceId: 'p-1',
	label: 'Headphones',
	amountMinor: 24900n,
	direction: 'none',
	date: { y: 2026, m: 3, d: 12 },
	estimate: false,
	...over
});

const input = (over: Partial<CalendarInput> = {}): CalendarInput => ({
	scheduled: [],
	dated: [],
	...over
});

describe('buildMonth — the shape of a month', () => {
	it('has a cell per day', () => {
		expect(buildMonth(input(), 2026, 3).days).toHaveLength(31);
		expect(buildMonth(input(), 2026, 2).days).toHaveLength(28);
		expect(buildMonth(input(), 2028, 2).days).toHaveLength(29);
	});

	it('reports the blanks before the 1st, so a week grid lines up', () => {
		// 1 March 2026 is a Sunday: six cells in on a Monday-first grid.
		expect(buildMonth(input(), 2026, 3).leadingBlanks).toBe(6);
		// 1 June 2026 is a Monday: none.
		expect(buildMonth(input(), 2026, 6).leadingBlanks).toBe(0);
	});

	it('is empty and balanced when nothing is scheduled', () => {
		const m = buildMonth(input(), 2026, 3);
		expect(m.inMinor).toBe(0n);
		expect(m.outMinor).toBe(0n);
		expect(m.days.every((d) => d.entries.length === 0)).toBe(true);
	});
});

describe('buildMonth — expanding rules', () => {
	it('places a monthly rule on its day', () => {
		const m = buildMonth(input({ scheduled: [scheduled()] }), 2026, 3);
		expect(m.days[0].entries.map((e) => e.label)).toEqual(['Rent']);
		expect(m.days[0].outMinor).toBe(145000n);
		expect(m.outMinor).toBe(145000n);
	});

	it('places every occurrence of a weekly rule', () => {
		const m = buildMonth(
			input({
				scheduled: [
					scheduled({ rrule: 'DTSTART=2025-01-06;FREQ=WEEKLY;BYDAY=MO', amountMinor: 1000n })
				]
			}),
			2026,
			3
		);
		const hits = m.days.filter((d) => d.entries.length > 0).map((d) => d.date.d);
		// Mondays in March 2026: 2, 9, 16, 23, 30.
		expect(hits).toEqual([2, 9, 16, 23, 30]);
		expect(m.outMinor).toBe(5000n);
	});

	it('does not redraw occurrences already materialized', () => {
		// The rule has already produced the 1st; only the later ones are forecast.
		const m = buildMonth(
			input({
				scheduled: [
					scheduled({
						rrule: 'DTSTART=2025-01-06;FREQ=WEEKLY;BYDAY=MO',
						notBefore: { y: 2026, m: 3, d: 16 }
					})
				]
			}),
			2026,
			3
		);
		expect(m.days.filter((d) => d.entries.length > 0).map((d) => d.date.d)).toEqual([16, 23, 30]);
	});

	it('ignores a notBefore that falls before the month', () => {
		const m = buildMonth(
			input({ scheduled: [scheduled({ notBefore: { y: 2025, m: 1, d: 1 } })] }),
			2026,
			3
		);
		expect(m.days[0].entries).toHaveLength(1);
	});

	it('skips a malformed rule rather than losing the month', () => {
		const m = buildMonth(
			input({ scheduled: [scheduled({ rrule: 'NOT A RULE' }), scheduled({ sourceId: 'r-2' })] }),
			2026,
			3
		);
		expect(m.days[0].entries.map((e) => e.sourceId)).toEqual(['r-2']);
	});
});

describe('buildMonth — direction and totals', () => {
	it('counts income in and bills out, and never nets them into one figure', () => {
		const m = buildMonth(
			input({
				scheduled: [
					scheduled({ kind: 'income', direction: 'in', label: 'Salary', amountMinor: 400000n }),
					scheduled({ sourceId: 'r-2', label: 'Rent', amountMinor: 145000n })
				]
			}),
			2026,
			3
		);
		expect(m.inMinor).toBe(400000n);
		expect(m.outMinor).toBe(145000n);
	});

	it('treats money set aside as leaving the spendable pile', () => {
		const m = buildMonth(
			input({
				scheduled: [scheduled({ kind: 'saving', label: 'Holiday', amountMinor: 20000n })]
			}),
			2026,
			3
		);
		expect(m.outMinor).toBe(20000n);
		expect(m.days[0].entries[0].kind).toBe('saving');
	});

	it('leaves a decision out of both totals — nothing has moved', () => {
		const m = buildMonth(input({ dated: [dated()] }), 2026, 3);
		expect(m.inMinor).toBe(0n);
		expect(m.outMinor).toBe(0n);
		expect(m.days[11].entries).toHaveLength(1);
	});
});

describe('buildMonth — one-off dates', () => {
	it('drops anything outside the month', () => {
		const m = buildMonth(
			input({
				dated: [
					dated({ date: { y: 2026, m: 4, d: 1 } }),
					dated({ sourceId: 'p-2', date: { y: 2026, m: 3, d: 5 } })
				]
			}),
			2026,
			3
		);
		expect(m.days.flatMap((d) => d.entries).map((e) => e.sourceId)).toEqual(['p-2']);
	});
});

describe('buildMonth — order within a day', () => {
	it('reads the way the day goes: what arrives, what leaves, what you must decide', () => {
		const m = buildMonth(
			input({
				scheduled: [
					scheduled({ sourceId: 'r-1', label: 'Rent', amountMinor: 145000n }),
					scheduled({
						sourceId: 'r-2',
						kind: 'income',
						direction: 'in',
						label: 'Salary',
						amountMinor: 400000n
					})
				],
				dated: [dated({ date: { y: 2026, m: 3, d: 1 } })]
			}),
			2026,
			3
		);
		expect(m.days[0].entries.map((e) => e.label)).toEqual(['Salary', 'Rent', 'Headphones']);
	});

	it('puts the bigger figure first, then falls back to the label for a stable grid', () => {
		const m = buildMonth(
			input({
				scheduled: [
					scheduled({ sourceId: 'a', label: 'Water', amountMinor: 3000n }),
					scheduled({ sourceId: 'b', label: 'Rent', amountMinor: 145000n }),
					scheduled({ sourceId: 'c', label: 'Aardvark fund', amountMinor: 3000n })
				]
			}),
			2026,
			3
		);
		expect(m.days[0].entries.map((e) => e.label)).toEqual(['Rent', 'Aardvark fund', 'Water']);
	});
});

describe('buildMonth — certain vs projected', () => {
	it('carries the estimate flag through, so a view can tell them apart', () => {
		const m = buildMonth(
			input({
				scheduled: [
					scheduled({ sourceId: 'a', label: 'Rent', estimate: false }),
					scheduled({ sourceId: 'b', label: 'Electricity', estimate: true })
				]
			}),
			2026,
			3
		);
		const byLabel = Object.fromEntries(m.days[0].entries.map((e) => [e.label, e.estimate]));
		expect(byLabel).toEqual({ Rent: false, Electricity: true });
	});
});
