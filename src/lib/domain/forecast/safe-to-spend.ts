/**
 * Safe to Spend — the number Harmony watches over.
 *
 * "Of the money we have this month, how much is still genuinely free — after
 * everything already spent, promised, and planned to save?" A deterministic
 * cash-flow read over the current month, computed per viewer so seals hold.
 *
 * Money never lies: this is pure integer arithmetic. Harmony *interprets* the
 * result (warnings, narration) but never computes it — cross that line once and
 * the trust the whole feature rests on is gone.
 *
 *   free = income − cashSpent − cashCommitted − upcomingBills − savings
 *
 * Buckets are deliberately out of the cash equation on the *spend* side: money
 * in a bucket was already set aside in some earlier month, so spending it isn't
 * this month's cash. Money moving *into* a bucket is, though — whether it has
 * already gone or is still due before month end, it is cash this month has
 * committed to saving, so it's subtracted. Reserved (pending) and sleeping (held)
 * are shown, not subtracted: pending might still be denied, sleeping might be let go.
 *
 * The one exception is an overdrawn bucket. "It was set aside earlier" only
 * holds when something actually was; a charge against a bucket with nothing in
 * it is ordinary cash leaving, so its unfunded part joins `cashSpentMinor`.
 * Without that, charging an empty bucket moved no number anywhere in the app.
 */

import type { Period } from '../analytics/period';
import {
	addDays,
	compareDates,
	nextOccurrence,
	type CalDate,
	type Recurrence
} from '../recurrence/rrule';

export interface SafeToSpendBreakdown {
	/** Everything coming in this month: one-off received + recurring projected. */
	incomeMinor: bigint;
	/** Completed non-bucket spending this month, net of refunds, plus the part of
	 *  this month's bucket charges no bucket had the money for. */
	cashSpentMinor: bigint;
	/** Approved-but-not-completed non-bucket purchases: money greenlit, not yet out. */
	cashCommittedMinor: bigint;
	/** Recurring charges still to land this month — bills you can't dodge. */
	upcomingBillsMinor: bigint;
	/** This month's saving: what has already moved into buckets, plus what is
	 *  still due to accrue before the month is out. */
	savingsMinor: bigint;
	/** Pending requests: shown provisionally, not yet committed. */
	reservedMinor: bigint;
	/** Sleeping (held) requests: on the horizon, not counted against you yet. */
	sleepingMinor: bigint;
	/** Discretionary budget left, as a guardrail. Null until wired. */
	budgetRemainingMinor: bigint | null;
}

/** clear = room to spare · tight = pending would push you over · over = already over. */
export type SafeToSpendStatus = 'clear' | 'tight' | 'over';

export interface SafeToSpend {
	/** The hero: free cash this month. Can be negative ("you're over"). */
	freeMinor: bigint;
	/** free − reserved: where you'd land if every pending request is approved. */
	afterReservedMinor: bigint;
	/** min(free, budget left) — honest about both cash and plan. Null until wired. */
	onPlanMinor: bigint | null;
	status: SafeToSpendStatus;
	horizon: Period;
	breakdown: SafeToSpendBreakdown;
}

export function computeSafeToSpend(b: SafeToSpendBreakdown, horizon: Period): SafeToSpend {
	const free =
		b.incomeMinor - b.cashSpentMinor - b.cashCommittedMinor - b.upcomingBillsMinor - b.savingsMinor;
	const afterReserved = free - b.reservedMinor;
	const onPlan =
		b.budgetRemainingMinor === null
			? null
			: free < b.budgetRemainingMinor
				? free
				: b.budgetRemainingMinor;
	const status: SafeToSpendStatus = free < 0n ? 'over' : afterReserved < 0n ? 'tight' : 'clear';
	return {
		freeMinor: free,
		afterReservedMinor: afterReserved,
		onPlanMinor: onPlan,
		status,
		horizon,
		breakdown: b
	};
}

/**
 * How Harmony reads the number — the emotional register that separates a warning
 * from a "you're fine". `tone` drives the color; `text` is the sentence.
 *
 * Still no math: this only *interprets* what `computeSafeToSpend` already decided,
 * choosing the single most useful thing to say. The order is deliberate — the
 * hardest constraint wins, because that's the one worth naming. Cash going
 * negative (over → tight) outranks a self-imposed budget (past → ceiling), which
 * outranks "all clear". `fmt` renders minor units the caller's way (currency,
 * locale), so this stays a pure string-shaping function.
 */
export interface SafeToSpendNarration {
	tone: SafeToSpendStatus | 'budget';
	text: string;
}

export function narrateSafeToSpend(
	r: SafeToSpend,
	fmt: (minor: bigint) => string
): SafeToSpendNarration {
	// Cash is already spent past what's coming in — the loudest signal.
	if (r.status === 'over') {
		return {
			tone: 'over',
			text: `You're ${fmt(-r.freeMinor)} over for the month. Worth holding off on new spends until more comes in.`
		};
	}
	// Cash is positive, but approving what's pending would tip it negative.
	if (r.status === 'tight') {
		return {
			tone: 'tight',
			text: `${fmt(r.freeMinor)} free, though approving everything pending would put you ${fmt(-r.afterReservedMinor)} under.`
		};
	}
	// Cash is fine; the budget is what you've overrun.
	if (r.onPlanMinor !== null && r.onPlanMinor < 0n) {
		return {
			tone: 'budget',
			text: `Cash is fine, but you're ${fmt(-r.onPlanMinor)} past your budget this month.`
		};
	}
	// Cash is fine; the budget is the tighter (still-positive) ceiling.
	if (r.onPlanMinor !== null && r.onPlanMinor < r.freeMinor) {
		return {
			tone: 'budget',
			text: `${fmt(r.freeMinor)} in the bank this month, though your budget is the real ceiling at ${fmt(r.onPlanMinor)}.`
		};
	}
	// Room to spare, nothing pressing.
	return {
		tone: 'clear',
		text: `${fmt(r.freeMinor)} free and clear. Everything this month is accounted for.`
	};
}

/**
 * Severity of the status as a number, so a proactive watch can compare "how bad
 * is it now" against "how bad was it when we last spoke". clear=0, tight=1, over=2.
 */
export type StsAlertLevel = 0 | 1 | 2;

export function statusLevel(status: SafeToSpendStatus): StsAlertLevel {
	return status === 'over' ? 2 : status === 'tight' ? 1 : 0;
}

/**
 * Whether a fresh alert at `newLevel` is worth sending, given the worst level
 * already sent this month (`storedLevel`) and whether that record is even from
 * this month. High-water mark per month: we speak up when things get *worse*
 * than we last said, never to repeat or to walk back. A new month resets the
 * bar to zero, so the first tight/over of the month always lands.
 */
export function supersedesStsAlert(
	newLevel: StsAlertLevel,
	storedLevel: StsAlertLevel,
	sameMonth: boolean
): boolean {
	const effective = sameMonth ? storedLevel : 0;
	return newLevel > effective;
}

/**
 * Sum a recurrence's occurrences in the calendar window [fromInclusive, toExclusive),
 * each worth `amountMinor`. Pure — the projection the repo leans on for both
 * "income expected this month" and "bills still to land". Bounded so a malformed
 * or absurdly dense rule can't spin.
 */
export function sumRecurringInWindow(
	rec: Recurrence,
	amountMinor: bigint,
	fromInclusive: CalDate,
	toExclusive: CalDate
): bigint {
	return BigInt(occurrencesInWindow(rec, fromInclusive, toExclusive).length) * amountMinor;
}

/**
 * The dates a recurrence lands on in [fromInclusive, toExclusive).
 *
 * The expansion itself, which `sumRecurringInWindow` used to keep to itself. A
 * calendar wants the days rather than the total, and having both read the same
 * walk is the point: a month whose figures and whose grid disagreed about when
 * a bill falls would be worse than either alone.
 *
 * Bounded at 400 iterations so a malformed or absurdly dense rule can't spin —
 * comfortably more than a daily rule produces in any window a caller asks for.
 */
export function occurrencesInWindow(
	rec: Recurrence,
	fromInclusive: CalDate,
	toExclusive: CalDate
): CalDate[] {
	if (compareDates(fromInclusive, toExclusive) >= 0) return [];
	const out: CalDate[] = [];
	let cursor = addDays(fromInclusive, -1); // nextOccurrence is strictly-after, so back up one
	for (let i = 0; i < 400; i++) {
		const occ = nextOccurrence(rec, cursor);
		if (compareDates(occ, toExclusive) >= 0) break;
		out.push(occ);
		cursor = occ;
	}
	return out;
}
