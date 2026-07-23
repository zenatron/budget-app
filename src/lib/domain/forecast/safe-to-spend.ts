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
 * this month's cash. The bucket *accrual* is, though — it's this month's savings
 * commitment, so it's subtracted. Reserved (pending) and sleeping (held) are
 * shown, not subtracted: pending might still be denied, sleeping might be let go.
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
	/** Completed non-bucket spending this month, net of refunds. */
	cashSpentMinor: bigint;
	/** Approved-but-not-completed non-bucket purchases: money greenlit, not yet out. */
	cashCommittedMinor: bigint;
	/** Recurring charges still to land this month — bills you can't dodge. */
	upcomingBillsMinor: bigint;
	/** This month's bucket accruals — cash you've chosen to move into savings. */
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
			text: `You're ${fmt(-r.freeMinor)} over for the month — worth holding off on new spends until more comes in.`
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
		text: `${fmt(r.freeMinor)} free and clear — everything this month is accounted for.`
	};
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
	if (compareDates(fromInclusive, toExclusive) >= 0) return 0n;
	let total = 0n;
	let cursor = addDays(fromInclusive, -1); // nextOccurrence is strictly-after, so back up one
	for (let i = 0; i < 400; i++) {
		const occ = nextOccurrence(rec, cursor);
		if (compareDates(occ, toExclusive) >= 0) break;
		total += amountMinor;
		cursor = occ;
	}
	return total;
}
