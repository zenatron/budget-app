import { describe, expect, it } from 'vitest';
import { monthPeriod } from '../analytics/period';
import { parseRRule } from '../recurrence/rrule';
import {
	computeSafeToSpend,
	narrateSafeToSpend,
	statusLevel,
	sumRecurringInWindow,
	supersedesStsAlert,
	type SafeToSpendBreakdown
} from './safe-to-spend';

/** Bare-minimum minor→string formatter for deterministic narration assertions. */
const fmt = (m: bigint) => `$${(Number(m) / 100).toFixed(2)}`;

const JULY = monthPeriod({ y: 2026, m: 7, d: 15 });

function breakdown(over: Partial<SafeToSpendBreakdown> = {}): SafeToSpendBreakdown {
	return {
		incomeMinor: 0n,
		cashSpentMinor: 0n,
		cashCommittedMinor: 0n,
		upcomingBillsMinor: 0n,
		savingsMinor: 0n,
		reservedMinor: 0n,
		sleepingMinor: 0n,
		budgetRemainingMinor: null,
		...over
	};
}

describe('computeSafeToSpend', () => {
	it('free = income − spent − committed − bills − savings', () => {
		const r = computeSafeToSpend(
			breakdown({
				incomeMinor: 500000n, // $5,000
				cashSpentMinor: 120000n, // $1,200
				cashCommittedMinor: 40000n, // $400
				upcomingBillsMinor: 98000n, // $980
				savingsMinor: 20000n // $200
			}),
			JULY
		);
		expect(r.freeMinor).toBe(222000n); // $2,220
		expect(r.status).toBe('clear');
	});

	it('reserved and sleeping never touch the free number', () => {
		const r = computeSafeToSpend(
			breakdown({ incomeMinor: 100000n, reservedMinor: 30000n, sleepingMinor: 50000n }),
			JULY
		);
		expect(r.freeMinor).toBe(100000n);
		expect(r.afterReservedMinor).toBe(70000n); // where you'd land if pending is approved
	});

	it('is "tight" when pending would push you over, "clear" otherwise', () => {
		const tight = computeSafeToSpend(
			breakdown({ incomeMinor: 100000n, reservedMinor: 120000n }),
			JULY
		);
		expect(tight.status).toBe('tight');
		expect(tight.freeMinor).toBe(100000n);
		expect(tight.afterReservedMinor).toBe(-20000n);
	});

	it('is "over" when free is already negative', () => {
		const r = computeSafeToSpend(
			breakdown({ incomeMinor: 100000n, cashSpentMinor: 90000n, upcomingBillsMinor: 30000n }),
			JULY
		);
		expect(r.freeMinor).toBe(-20000n);
		expect(r.status).toBe('over');
	});

	it('onPlan is the lower of free cash and budget left; null until wired', () => {
		expect(computeSafeToSpend(breakdown({ incomeMinor: 100000n }), JULY).onPlanMinor).toBeNull();
		const withBudget = computeSafeToSpend(
			breakdown({ incomeMinor: 100000n, budgetRemainingMinor: 30000n }),
			JULY
		);
		expect(withBudget.freeMinor).toBe(100000n);
		expect(withBudget.onPlanMinor).toBe(30000n); // budget is the tighter constraint
	});
});

describe('narrateSafeToSpend', () => {
	const say = (over: Partial<SafeToSpendBreakdown>) =>
		narrateSafeToSpend(computeSafeToSpend(breakdown(over), JULY), fmt);

	it('leads with cash when you are over for the month', () => {
		const n = say({ incomeMinor: 100000n, cashSpentMinor: 130000n });
		expect(n.tone).toBe('over');
		expect(n.text).toContain('$300.00 over');
	});

	it('warns when pending would tip positive cash negative', () => {
		const n = say({ incomeMinor: 100000n, reservedMinor: 120000n });
		expect(n.tone).toBe('tight');
		expect(n.text).toContain('$1000.00 free');
		expect(n.text).toContain('$200.00 under');
	});

	it('cash outranks budget: tight wins even when also past budget', () => {
		const n = say({ incomeMinor: 100000n, reservedMinor: 120000n, budgetRemainingMinor: -5000n });
		expect(n.tone).toBe('tight');
	});

	it('names the budget overrun when cash is fine', () => {
		const n = say({ incomeMinor: 100000n, budgetRemainingMinor: -8000n });
		expect(n.tone).toBe('budget');
		expect(n.text).toContain('$80.00 past your budget');
	});

	it('calls the budget the ceiling when it is the tighter positive limit', () => {
		const n = say({ incomeMinor: 100000n, budgetRemainingMinor: 30000n });
		expect(n.tone).toBe('budget');
		expect(n.text).toContain('$300.00');
	});

	it('is all-clear with room to spare and nothing pressing', () => {
		const n = say({ incomeMinor: 100000n, cashSpentMinor: 20000n });
		expect(n.tone).toBe('clear');
		expect(n.text).toContain('$800.00 free and clear');
	});
});

describe('safe-to-spend alert level', () => {
	it('maps status to severity', () => {
		expect(statusLevel('clear')).toBe(0);
		expect(statusLevel('tight')).toBe(1);
		expect(statusLevel('over')).toBe(2);
	});

	it('fires the first tight/over of the month', () => {
		expect(supersedesStsAlert(1, 0, true)).toBe(true);
		expect(supersedesStsAlert(2, 0, true)).toBe(true);
	});

	it('escalates tight → over, but never repeats or walks back', () => {
		expect(supersedesStsAlert(2, 1, true)).toBe(true); // worsened
		expect(supersedesStsAlert(1, 1, true)).toBe(false); // same
		expect(supersedesStsAlert(1, 2, true)).toBe(false); // improved, stay quiet
	});

	it('resets the bar in a new month', () => {
		expect(supersedesStsAlert(1, 2, false)).toBe(true); // last month was worse, this month is fresh
	});
});

describe('sumRecurringInWindow', () => {
	const usd = 1000n;

	it('counts a monthly bill once within a month window', () => {
		const rent = parseRRule('DTSTART=2025-01-01;FREQ=MONTHLY;BYMONTHDAY=1');
		expect(sumRecurringInWindow(rent, usd, { y: 2026, m: 7, d: 1 }, { y: 2026, m: 8, d: 1 })).toBe(
			usd
		);
	});

	it('includes an occurrence on the window start, excludes one on the exclusive end', () => {
		const first = parseRRule('DTSTART=2025-01-01;FREQ=MONTHLY;BYMONTHDAY=1');
		// window [Jul 1, Aug 1): the Jul 1 hit is in, the Aug 1 hit is out.
		expect(sumRecurringInWindow(first, usd, { y: 2026, m: 7, d: 1 }, { y: 2026, m: 8, d: 1 })).toBe(
			usd
		);
	});

	it('counts every weekly occurrence in the window', () => {
		const weekly = parseRRule('DTSTART=2026-07-06;FREQ=WEEKLY;BYDAY=MO');
		// Mondays in July 2026: 6, 13, 20, 27 → 4 occurrences
		expect(sumRecurringInWindow(weekly, usd, { y: 2026, m: 7, d: 1 }, { y: 2026, m: 8, d: 1 })).toBe(
			4n * usd
		);
	});

	it('is zero when the next occurrence is past the window', () => {
		const yearly = parseRRule('DTSTART=2026-01-15;FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=15');
		expect(sumRecurringInWindow(yearly, usd, { y: 2026, m: 7, d: 1 }, { y: 2026, m: 8, d: 1 })).toBe(
			0n
		);
	});

	it('is zero for an empty or inverted window', () => {
		const daily = parseRRule('DTSTART=2026-07-01;FREQ=DAILY');
		expect(sumRecurringInWindow(daily, usd, { y: 2026, m: 8, d: 1 }, { y: 2026, m: 7, d: 1 })).toBe(
			0n
		);
	});
});
