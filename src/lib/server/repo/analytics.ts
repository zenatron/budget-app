import { and, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import {
	approvalEvent,
	budget,
	category,
	purchase,
	user,
	workspaceMember
} from '$lib/server/db/schema';
import { periodBoundsUtc, type Period } from '$lib/domain/analytics/period';
import { visibleTo } from './purchases';

/**
 * All analytics are computed on the fly, seal-filtered per viewer. This is
 * where the subtraction attack dies: a concealed viewer's totals simply do
 * not include sealed rows, so no aggregate can be differenced against their
 * own spending to reveal a gift. Numbers correct themselves on unseal.
 */

export interface AnalyticsScope {
	workspaceId: string;
	viewerId: string;
	timezone: string;
}

function spentInPeriod(scope: AnalyticsScope, period: Period, now: Date) {
	const { from, to } = periodBoundsUtc(period, scope.timezone);
	// 'refunded' rows are counted too: a fully refunded parent (+X) and its
	// negative children (−X) net to zero, and partial refunds subtract exactly.
	return and(
		eq(purchase.workspaceId, scope.workspaceId),
		inArray(purchase.state, ['completed', 'refunded']),
		gte(purchase.completedAt, from),
		lt(purchase.completedAt, to),
		visibleTo(scope.viewerId, now)
	);
}

export async function periodTotal(
	db: Db,
	scope: AnalyticsScope,
	period: Period,
	now: Date
): Promise<bigint> {
	const [row] = await db
		.select({ total: sql<string>`coalesce(sum(${purchase.finalAmountMinor}), 0)` })
		.from(purchase)
		.where(spentInPeriod(scope, period, now));
	return BigInt(row.total);
}

export interface CategorySlice {
	categoryId: string | null;
	name: string;
	icon: string | null;
	color: string | null;
	totalMinor: bigint;
}

export async function categoryBreakdown(
	db: Db,
	scope: AnalyticsScope,
	period: Period,
	now: Date
): Promise<CategorySlice[]> {
	const rows = await db
		.select({
			categoryId: purchase.categoryId,
			name: category.name,
			icon: category.icon,
			color: category.color,
			total: sql<string>`sum(${purchase.finalAmountMinor})`
		})
		.from(purchase)
		.leftJoin(category, eq(purchase.categoryId, category.id))
		.where(spentInPeriod(scope, period, now))
		.groupBy(purchase.categoryId, category.name, category.icon, category.color)
		.orderBy(sql`sum(${purchase.finalAmountMinor}) desc`);
	return rows.map((r) => ({
		categoryId: r.categoryId,
		// "Other", not "Uncategorized": this is a legitimate place for a one-off to
		// live, and naming it after what it lacks made it read as a chore.
		name: r.name ?? 'Other',
		icon: r.icon,
		color: r.color,
		totalMinor: BigInt(r.total)
	}));
}

export interface MemberSlice {
	memberId: string;
	name: string;
	totalMinor: bigint;
}

export async function memberBreakdown(
	db: Db,
	scope: AnalyticsScope,
	period: Period,
	now: Date
): Promise<MemberSlice[]> {
	const rows = await db
		.select({
			memberId: purchase.memberId,
			name: user.displayName,
			total: sql<string>`sum(${purchase.finalAmountMinor})`
		})
		.from(purchase)
		.innerJoin(workspaceMember, eq(purchase.memberId, workspaceMember.id))
		.innerJoin(user, eq(workspaceMember.userId, user.id))
		.where(spentInPeriod(scope, period, now))
		.groupBy(purchase.memberId, user.displayName)
		.orderBy(sql`sum(${purchase.finalAmountMinor}) desc`);
	return rows.map((r) => ({ memberId: r.memberId, name: r.name, totalMinor: BigInt(r.total) }));
}

/** Daily totals keyed 'YYYY-MM-DD' in the workspace timezone. */
export async function dailyTrend(
	db: Db,
	scope: AnalyticsScope,
	period: Period,
	now: Date
): Promise<Map<string, bigint>> {
	const day = sql<string>`to_char(${purchase.completedAt} at time zone ${scope.timezone}, 'YYYY-MM-DD')`;
	const rows = await db
		.select({ day, total: sql<string>`sum(${purchase.finalAmountMinor})` })
		.from(purchase)
		.where(spentInPeriod(scope, period, now))
		.groupBy(sql`1`);
	return new Map(rows.map((r) => [r.day, BigInt(r.total)]));
}

/** Monthly totals for year view, keyed 'YYYY-MM'. */
export async function monthlyTrend(
	db: Db,
	scope: AnalyticsScope,
	period: Period,
	now: Date
): Promise<Map<string, bigint>> {
	const mon = sql<string>`to_char(${purchase.completedAt} at time zone ${scope.timezone}, 'YYYY-MM')`;
	const rows = await db
		.select({ mon, total: sql<string>`sum(${purchase.finalAmountMinor})` })
		.from(purchase)
		.where(spentInPeriod(scope, period, now))
		.groupBy(sql`1`);
	return new Map(rows.map((r) => [r.mon, BigInt(r.total)]));
}

/** Per-bucket category breakdown: map of "bucketKey:categoryId" → total. */
export async function bucketCategoryTrend(
	db: Db,
	scope: AnalyticsScope,
	period: Period,
	now: Date,
	granularity: 'day' | 'month'
): Promise<Map<string, bigint>> {
	const bucketCol =
		granularity === 'month'
			? sql<string>`to_char(${purchase.completedAt} at time zone ${scope.timezone}, 'YYYY-MM')`
			: sql<string>`to_char(${purchase.completedAt} at time zone ${scope.timezone}, 'YYYY-MM-DD')`;
	const rows = await db
		.select({
			bucket: bucketCol,
			categoryId: purchase.categoryId,
			total: sql<string>`sum(${purchase.finalAmountMinor})`
		})
		.from(purchase)
		.where(spentInPeriod(scope, period, now))
		.groupBy(sql`1`, purchase.categoryId);
	const result = new Map<string, bigint>();
	for (const r of rows) {
		result.set(`${r.bucket}:${r.categoryId ?? '__none__'}`, BigInt(r.total));
	}
	return result;
}

export interface BudgetLine {
	budgetId: string;
	categoryId: string | null;
	categoryName: string;
	categoryIcon: string | null;
	budgetMinor: bigint;
	actualMinor: bigint;
}

/** Month budgets in force during the period, with seal-filtered actuals. */
export async function budgetVsActual(
	db: Db,
	scope: AnalyticsScope,
	period: Period,
	now: Date
): Promise<BudgetLine[]> {
	const pad = (n: number) => String(n).padStart(2, '0');
	const fromStr = `${period.from.y}-${pad(period.from.m)}-${pad(period.from.d)}`;
	const budgets = await db
		.select({
			id: budget.id,
			categoryId: budget.categoryId,
			amountMinor: budget.amountMinor,
			categoryName: category.name,
			categoryIcon: category.icon
		})
		.from(budget)
		.leftJoin(category, eq(budget.categoryId, category.id))
		.where(
			and(
				eq(budget.workspaceId, scope.workspaceId),
				eq(budget.period, 'month'),
				lte(budget.effectiveFrom, fromStr),
				or(isNull(budget.effectiveTo), gt(budget.effectiveTo, fromStr))
			)
		);
	if (budgets.length === 0) return [];

	const byCategory = await categoryBreakdown(db, scope, period, now);
	const total = byCategory.reduce((a, s) => a + s.totalMinor, 0n);
	return budgets.map((b) => ({
		budgetId: b.id,
		categoryId: b.categoryId,
		categoryName: b.categoryId === null ? 'Everything' : (b.categoryName ?? 'Unknown'),
		categoryIcon: b.categoryIcon,
		budgetMinor: b.amountMinor,
		actualMinor:
			b.categoryId === null
				? total
				: (byCategory.find((s) => s.categoryId === b.categoryId)?.totalMinor ?? 0n)
	}));
}

export interface VerdictTotals {
	/** Completed spend, net of refunds. */
	approvedMinor: bigint;
	/** Money that came back, as a positive number. */
	refundedMinor: bigint;
	/** Requested amounts that were turned down. */
	deniedMinor: bigint;
	/** Requested amounts the requester withdrew before a decision. */
	cancelledMinor: bigint;
	/** Slept on, then let go — the impulse buys avoided. Subset of cancelled. */
	letGoMinor: bigint;
}

/**
 * Lifetime totals for the three settled outcomes. Only decided purchases
 * count — pending and draft rows have no verdict yet, and `approved` is
 * excluded because nothing has been spent until it completes.
 *
 * Refunds need no special arithmetic: a refund is a child row carrying a
 * negative final amount, so summing completed and refunded rows subtracts it
 * from the approved total on its own. The refunded figure is those children
 * on their own, sign-flipped.
 *
 * Seal-filtered like every other aggregate — a concealed purchase must not
 * show up in a lifetime number either.
 */
export async function verdictTotals(
	db: Db,
	scope: { workspaceId: string; viewerId: string },
	now: Date
): Promise<VerdictTotals> {
	const [row] = await db
		.select({
			approved: sql<string>`coalesce(sum(${purchase.finalAmountMinor}) filter (
				where ${purchase.state} in ('completed', 'refunded')
			), 0)`,
			refunded: sql<string>`coalesce(-sum(${purchase.finalAmountMinor}) filter (
				where ${purchase.parentPurchaseId} is not null and ${purchase.finalAmountMinor} < 0
			), 0)`,
			denied: sql<string>`coalesce(sum(${purchase.requestedAmountMinor}) filter (
				where ${purchase.state} = 'denied'
			), 0)`,
			cancelled: sql<string>`coalesce(sum(${purchase.requestedAmountMinor}) filter (
				where ${purchase.state} = 'cancelled'
			), 0)`,
			// The correlation must be fully qualified: a bare ${purchase.id} renders
			// as "id", which the subquery binds to approval_event.id instead.
			letGo: sql<string>`coalesce(sum(${purchase.requestedAmountMinor}) filter (
				where ${purchase.state} = 'cancelled' and exists (
					select 1 from ${approvalEvent} ae
					where ae.purchase_id = "purchase"."id" and ae.reason = 'let it go'
				)
			), 0)`
		})
		.from(purchase)
		.where(and(eq(purchase.workspaceId, scope.workspaceId), visibleTo(scope.viewerId, now)));

	return {
		approvedMinor: BigInt(row?.approved ?? '0'),
		refundedMinor: BigInt(row?.refunded ?? '0'),
		deniedMinor: BigInt(row?.denied ?? '0'),
		cancelledMinor: BigInt(row?.cancelled ?? '0'),
		letGoMinor: BigInt(row?.letGo ?? '0')
	};
}
