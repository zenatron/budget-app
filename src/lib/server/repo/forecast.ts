import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { bucket, income, purchase, recurringRule } from '$lib/server/db/schema';
import { monthPeriod, periodBoundsUtc } from '$lib/domain/analytics/period';
import { calDateInZone } from '$lib/domain/time/zoned';
import { compareDates, parseRRule } from '$lib/domain/recurrence/rrule';
import {
	computeSafeToSpend,
	sumRecurringInWindow,
	type SafeToSpend
} from '$lib/domain/forecast/safe-to-spend';
import { budgetVsActual } from './analytics';
import { visibleTo } from './purchases';

interface ForecastScope {
	workspaceId: string;
	/** Seal viewer: spent/committed/reserved/sleeping are computed as they see it. */
	viewerId: string;
	timezone: string;
}

/**
 * Compute Safe to Spend for the current month, seal-scoped to the viewer.
 *
 * Income, upcoming bills, and planned savings are household-wide (none of them
 * can be sealed). The purchase-derived flows — spent, committed, reserved,
 * sleeping — go through `visibleTo`, so a gift the viewer sealed lowers their own
 * number while staying invisible in the number the concealed member sees.
 */
export async function safeToSpend(db: Db, scope: ForecastScope, now: Date): Promise<SafeToSpend> {
	const today = calDateInZone(now, scope.timezone);
	const period = monthPeriod(today);
	const { from, to } = periodBoundsUtc(period, scope.timezone);

	const [incomeMinor, upcomingBillsMinor, savingsMinor, flows, budgetRemainingMinor] =
		await Promise.all([
			monthIncome(db, scope.workspaceId, period, scope.timezone),
			upcomingBills(db, scope.workspaceId, period, scope.timezone),
			plannedSavings(db, scope.workspaceId),
			purchaseFlows(db, scope, from, to, now),
			budgetRemaining(db, scope, period, now)
		]);

	return computeSafeToSpend(
		{
			incomeMinor,
			cashSpentMinor: flows.cashSpentMinor,
			cashCommittedMinor: flows.cashCommittedMinor,
			upcomingBillsMinor,
			savingsMinor,
			reservedMinor: flows.reservedMinor,
			sleepingMinor: flows.sleepingMinor,
			budgetRemainingMinor
		},
		period
	);
}

/** All income landing this month — one-off received + recurring projected across the whole period. */
async function monthIncome(
	db: Db,
	workspaceId: string,
	period: ReturnType<typeof monthPeriod>,
	tz: string
): Promise<bigint> {
	const { from, to } = periodBoundsUtc(period, tz);
	const rows = await db
		.select({ amountMinor: income.amountMinor, rrule: income.rrule, receivedAt: income.receivedAt })
		.from(income)
		.where(eq(income.workspaceId, workspaceId));

	let total = 0n;
	for (const r of rows) {
		if (r.rrule) {
			try {
				total += sumRecurringInWindow(
					parseRRule(r.rrule),
					r.amountMinor,
					period.from,
					period.toExclusive
				);
			} catch {
				/* malformed income rule — leave it out rather than guess */
			}
		} else if (r.receivedAt >= from && r.receivedAt < to) {
			total += r.amountMinor;
		}
	}
	return total;
}

/** Recurring charges still to land this month — projected from each rule's next unmaterialized occurrence. */
async function upcomingBills(
	db: Db,
	workspaceId: string,
	period: ReturnType<typeof monthPeriod>,
	tz: string
): Promise<bigint> {
	const rules = await db
		.select({
			amountMinor: recurringRule.amountMinor,
			rrule: recurringRule.rrule,
			nextOccurrenceAt: recurringRule.nextOccurrenceAt
		})
		.from(recurringRule)
		.where(and(eq(recurringRule.workspaceId, workspaceId), eq(recurringRule.status, 'active')));

	let total = 0n;
	for (const r of rules) {
		if (!r.nextOccurrenceAt) continue;
		try {
			// Only count occurrences still to materialize this month: start at the
			// rule's next occurrence, but never before the month itself.
			const nextCal = calDateInZone(r.nextOccurrenceAt, tz);
			const fromCal = compareDates(nextCal, period.from) < 0 ? period.from : nextCal;
			total += sumRecurringInWindow(
				parseRRule(r.rrule),
				r.amountMinor,
				fromCal,
				period.toExclusive
			);
		} catch {
			/* malformed rule — skip it, the same way the sweep does */
		}
	}
	return total;
}

/** This month's bucket accruals — the cash you've chosen to set aside, capped at each goal. */
async function plannedSavings(db: Db, workspaceId: string): Promise<bigint> {
	const rows = await db
		.select({
			monthly: bucket.monthlyAmountMinor,
			goalCap: bucket.goalCapMinor,
			balance: sql<string>`coalesce((
				select sum(bt.amount_minor) from bucket_transaction bt where bt.bucket_id = ${bucket.id}
			), 0)`
		})
		.from(bucket)
		.where(and(eq(bucket.workspaceId, workspaceId), eq(bucket.status, 'active')));

	let total = 0n;
	for (const r of rows) {
		if (r.goalCap === null) {
			total += r.monthly;
		} else {
			// Won't accrue past the goal: only the room left, at most this month's amount.
			const room = r.goalCap - BigInt(r.balance);
			total += room <= 0n ? 0n : room < r.monthly ? room : r.monthly;
		}
	}
	return total;
}

/**
 * The plan guardrail: how much budget is left this month, or null if none is set.
 * An overall budget (the "Everything" cap) is the truest ceiling, so it wins;
 * otherwise sum the room left in each category budget (a category under its cap
 * doesn't fund one that's over, so each line floors at zero). Seal-aware via
 * budgetVsActual → categoryBreakdown → visibleTo.
 */
async function budgetRemaining(
	db: Db,
	scope: ForecastScope,
	period: ReturnType<typeof monthPeriod>,
	now: Date
): Promise<bigint | null> {
	const lines = await budgetVsActual(db, scope, period, now);
	if (lines.length === 0) return null;
	const overall = lines.find((l) => l.categoryId === null);
	if (overall) return overall.budgetMinor - overall.actualMinor; // may be negative: over the plan
	return lines.reduce((a, l) => {
		const room = l.budgetMinor - l.actualMinor;
		return a + (room > 0n ? room : 0n);
	}, 0n);
}

/** Seal-aware, cash-only (bucket-charged excluded) purchase flows for the viewer. */
async function purchaseFlows(
	db: Db,
	scope: ForecastScope,
	from: Date,
	to: Date,
	now: Date
): Promise<{
	cashSpentMinor: bigint;
	cashCommittedMinor: bigint;
	reservedMinor: bigint;
	sleepingMinor: bigint;
}> {
	const [row] = await db
		.select({
			// Completed non-bucket spend this month, refunds netting out.
			spent: sql<string>`coalesce(sum(${purchase.finalAmountMinor}) filter (
				where ${purchase.state} in ('completed', 'refunded')
				and ${purchase.completedAt} >= ${from.toISOString()}::timestamptz
				and ${purchase.completedAt} < ${to.toISOString()}::timestamptz
				and ${purchase.bucketId} is null
			), 0)`,
			// Approved but not yet completed — money greenlit, cash not out yet.
			committed: sql<string>`coalesce(sum(coalesce(${purchase.approvedAmountMinor}, ${purchase.requestedAmountMinor})) filter (
				where ${purchase.state} = 'approved' and ${purchase.bucketId} is null
			), 0)`,
			reserved: sql<string>`coalesce(sum(${purchase.requestedAmountMinor}) filter (
				where ${purchase.state} = 'pending_approval' and ${purchase.bucketId} is null
			), 0)`,
			sleeping: sql<string>`coalesce(sum(${purchase.requestedAmountMinor}) filter (
				where ${purchase.state} = 'held' and ${purchase.bucketId} is null
			), 0)`
		})
		.from(purchase)
		.where(and(eq(purchase.workspaceId, scope.workspaceId), visibleTo(scope.viewerId, now)));

	return {
		cashSpentMinor: BigInt(row?.spent ?? '0'),
		cashCommittedMinor: BigInt(row?.committed ?? '0'),
		reservedMinor: BigInt(row?.reserved ?? '0'),
		sleepingMinor: BigInt(row?.sleeping ?? '0')
	};
}
