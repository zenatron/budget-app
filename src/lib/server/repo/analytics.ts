import { and, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { budget, category, purchase, user, workspaceMember } from '$lib/server/db/schema';
import type { Period } from '$lib/domain/analytics/period';
import { zonedTimeToUtc } from '$lib/domain/time/zoned';
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

function periodBoundsUtc(period: Period, timezone: string): { from: Date; to: Date } {
	return {
		from: zonedTimeToUtc(period.from, 0, 0, timezone),
		to: zonedTimeToUtc(period.toExclusive, 0, 0, timezone)
	};
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
		name: r.name ?? 'Uncategorized',
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
		// Group by ordinal: repeating the expression would bind the timezone
		// twice and Postgres would no longer see it as the same expression.
		.groupBy(sql`1`);
	return new Map(rows.map((r) => [r.day, BigInt(r.total)]));
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
				or(isNull(budget.effectiveTo), gte(budget.effectiveTo, fromStr))
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
