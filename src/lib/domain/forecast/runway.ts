/**
 * Forward projection — the months after this one.
 *
 * Safe to Spend answers "how much this month?" honestly and only for this month:
 * it leans on real actuals plus the recurring charges still to land. That's the
 * right scope for a headline you spend against today, but it can't answer the
 * quieter question a household actually plans around — "are we alright next
 * month, and the one after?"
 *
 * This projects each future month from the same recurring facts Safe to Spend
 * already uses: the income that repeats, the bills that repeat, the money that
 * accrues into buckets, and any one-off income already dated ahead. A future
 * month has no actuals, so every figure here is a projection — said plainly, the
 * way the estimate line in Safe to Spend is said plainly. Nothing here is spent
 * yet; nothing here is a promise.
 *
 * Pure: the repo gathers the rules and hands them in. All math is bigint minor
 * units, so nothing rounds.
 */
import { type CalDate, type Recurrence } from '$lib/domain/recurrence/rrule';
import { sumRecurringInWindow } from './safe-to-spend';

/** A repeating cash flow — an income source, a bill, or a bucket accrual. */
export interface RecurringFlow {
	rec: Recurrence;
	amountMinor: bigint;
	/**
	 * True for a confirm-at-price bill: the amount is the rule's best guess of
	 * what will be owed, not a figure anyone has verified. Bills only — income
	 * and bucket accruals are always the rule's own amounts.
	 */
	estimated?: boolean;
}

/** A known, dated, one-time income (a bonus, a gift), not a repeat. */
export interface DatedFlow {
	on: CalDate;
	amountMinor: bigint;
}

export interface ProjectionInputs {
	incomeRules: RecurringFlow[];
	billRules: RecurringFlow[];
	/** Bucket accruals — money that leaves free cash to become savings. */
	savingRules: RecurringFlow[];
	/** One-off income already on the calendar for a future month. */
	oneOffIncome: DatedFlow[];
}

export interface MonthProjection {
	/** First day of the projected month. */
	month: CalDate;
	incomeMinor: bigint;
	billsMinor: bigint;
	savingsMinor: bigint;
	/** income − bills − savings. Negative means the month is projected short. */
	freeMinor: bigint;
	/**
	 * True when any bill behind this month projects at a price that isn't final
	 * (a confirm-at-price rule landed in it). The notation is the caller's —
	 * the ledger wears a dotted underline for the same fact this month.
	 */
	estimated: boolean;
}

export interface Runway {
	months: MonthProjection[];
	/** Leading months (from the first projected month) that stay non-negative. */
	clearMonths: number;
	/** First month projected to end short, or null if all clear across the horizon. */
	firstShortMonth: CalDate | null;
}

/** First day of the month after `d`. */
export function nextMonthStart(d: CalDate): CalDate {
	return d.m === 12 ? { y: d.y + 1, m: 1, d: 1 } : { y: d.y, m: d.m + 1, d: 1 };
}

function inWindow(d: CalDate, fromInclusive: CalDate, toExclusive: CalDate): boolean {
	return (
		(d.y > fromInclusive.y ||
			(d.y === fromInclusive.y &&
				(d.m > fromInclusive.m || (d.m === fromInclusive.m && d.d >= fromInclusive.d)))) &&
		(d.y < toExclusive.y ||
			(d.y === toExclusive.y &&
				(d.m < toExclusive.m || (d.m === toExclusive.m && d.d < toExclusive.d))))
	);
}

/**
 * Project the `k` months that follow `firstMonth` (inclusive of it).
 *
 * `firstMonth` should be the first day of the first month you want projected —
 * for a runway shown beside this month's Safe to Spend, that's the *next* month,
 * since this month is already answered by Safe to Spend itself.
 */
export function projectRunway(inputs: ProjectionInputs, firstMonth: CalDate, k: number): Runway {
	const months: MonthProjection[] = [];
	let start: CalDate = { y: firstMonth.y, m: firstMonth.m, d: 1 };

	for (let i = 0; i < k; i++) {
		const end = nextMonthStart(start);
		const recurringIncome = inputs.incomeRules.reduce(
			(sum, f) => sum + sumRecurringInWindow(f.rec, f.amountMinor, start, end),
			0n
		);
		const oneOff = inputs.oneOffIncome.reduce(
			(sum, f) => (inWindow(f.on, start, end) ? sum + f.amountMinor : sum),
			0n
		);
		const incomeMinor = recurringIncome + oneOff;
		// A month is an estimate if any confirm-at-price bill actually lands in
		// it — a rule that doesn't contribute has no bearing on the figure, the
		// same line upcomingBills draws for this month.
		let estimated = false;
		const billsMinor = inputs.billRules.reduce((sum, f) => {
			const part = sumRecurringInWindow(f.rec, f.amountMinor, start, end);
			if (part > 0n && f.estimated) estimated = true;
			return sum + part;
		}, 0n);
		const savingsMinor = inputs.savingRules.reduce(
			(sum, f) => sum + sumRecurringInWindow(f.rec, f.amountMinor, start, end),
			0n
		);
		months.push({
			month: start,
			incomeMinor,
			billsMinor,
			savingsMinor,
			freeMinor: incomeMinor - billsMinor - savingsMinor,
			estimated
		});
		start = end;
	}

	let clearMonths = 0;
	for (const m of months) {
		if (m.freeMinor < 0n) break;
		clearMonths += 1;
	}
	const firstShort = months.find((m) => m.freeMinor < 0n);

	return { months, clearMonths, firstShortMonth: firstShort ? firstShort.month : null };
}
