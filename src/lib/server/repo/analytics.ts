import { and, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import {
	approvalEvent,
	budget,
	category,
	merchant,
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

/** How many completed purchases landed in the period, seal-scoped to the viewer. */
export async function periodCount(
	db: Db,
	scope: AnalyticsScope,
	period: Period,
	now: Date
): Promise<number> {
	const [row] = await db
		.select({ n: sql<string>`count(*)` })
		.from(purchase)
		.where(spentInPeriod(scope, period, now));
	return Number(row?.n ?? '0');
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

/*
 * ── Places ────────────────────────────────────────────────────────────────
 *
 * These live here, and not in a `repo/places.ts`, for one structural reason:
 * `spentInPeriod` above is module-private, and it is the single place where
 * workspace + state + period + `visibleTo` are bundled. A separate file would
 * force it to be exported, and the moment that predicate is exported somebody
 * will reach for four of its five clauses. Keeping location queries in this
 * file means one physically cannot be written without it in reach.
 *
 * **The seal trap.** `merchant` rows are workspace-global and carry no seal of
 * their own, so `select … from merchant where lat_e3 is not null` would hand a
 * concealed viewer the location of a vendor that exists only because of a
 * sealed gift. Both queries below enter through `purchase` — where the filter
 * applies — and join out to `merchant`. Never the other way round.
 */

export interface BBoxE3 {
	minLatE3: number;
	minLngE3: number;
	maxLatE3: number;
	maxLngE3: number;
}

export interface LocatedPoint {
	purchaseId: string;
	latE3: number;
	lngE3: number;
	totalMinor: bigint;
	label: string | null;
	color: string | null;
	/** True when the pin came from the vendor's default rather than the purchase. */
	inherited: boolean;
}

/**
 * The map's whole input: every located purchase in the period, seal-filtered.
 *
 * A purchase's own pin wins; the vendor's saved default fills in otherwise,
 * which is what puts a purchase logged from the sofa on the map at all.
 *
 * Capped. A household that somehow exceeds this gets its biggest spending
 * rather than an OOM, and the caller is told it was truncated — a map lying by
 * omission with no tell is worse than a slow one. If the cap is ever genuinely
 * reached, that is the signal to move clustering into SQL; the columns are
 * integers precisely so `group by lat_e3 / N` is a one-line change.
 */
export const MAP_POINT_CAP = 2000;

export async function locatedSpending(
	db: Db,
	scope: AnalyticsScope,
	period: Period,
	now: Date,
	bbox?: BBoxE3
): Promise<{ points: LocatedPoint[]; truncated: boolean }> {
	const lat = sql<number>`coalesce(${purchase.latE3}, ${merchant.latE3})`;
	const lng = sql<number>`coalesce(${purchase.lngE3}, ${merchant.lngE3})`;

	const rows = await db
		.select({
			purchaseId: purchase.id,
			latE3: lat,
			lngE3: lng,
			total: sql<string>`${purchase.finalAmountMinor}`,
			label: sql<string | null>`coalesce(${merchant.name}, ${purchase.placeLabel})`,
			color: category.color,
			ownPin: purchase.latE3
		})
		.from(purchase)
		.leftJoin(merchant, eq(purchase.merchantId, merchant.id))
		.leftJoin(category, eq(purchase.categoryId, category.id))
		.where(
			and(
				spentInPeriod(scope, period, now),
				sql`${lat} is not null`,
				...(bbox
					? [
							sql`${lat} between ${bbox.minLatE3} and ${bbox.maxLatE3}`,
							sql`${lng} between ${bbox.minLngE3} and ${bbox.maxLngE3}`
						]
					: [])
			)
		)
		.orderBy(sql`${purchase.finalAmountMinor} desc nulls last`)
		.limit(MAP_POINT_CAP + 1);

	const truncated = rows.length > MAP_POINT_CAP;
	return {
		truncated,
		points: rows.slice(0, MAP_POINT_CAP).map((r) => ({
			purchaseId: r.purchaseId,
			latE3: Number(r.latE3),
			lngE3: Number(r.lngE3),
			totalMinor: BigInt(r.total ?? '0'),
			label: r.label,
			color: r.color,
			inherited: r.ownPin === null
		}))
	};
}

export interface PlaceSlice {
	/** Vendor id, or the typed name, or "e3:LAT:LNG" — see placeBreakdown. */
	key: string;
	label: string;
	/** Centroid of the pins in this group. */
	latE3: number;
	lngE3: number;
	/** Extent of them, so a drill-through covers every row that was counted. */
	bboxE3: BBoxE3;
	totalMinor: bigint;
	count: number;
}

/**
 * "By place" on the Activity page, and the MCP tool.
 *
 * The grouping key is, in order: the vendor, then the name the person gave the
 * place, then the rounded cell. That order matters. Grouping on the cell alone
 * split "Union Square" into two rows one millidegree apart — same name, same
 * place, two totals — which reads as a bug even though both figures were right.
 * A name somebody typed *is* the identity they gave that place, so it wins over
 * the arithmetic; the cell is only the fallback for a pin nobody named.
 *
 * Same predicate as everything else on the page, so the figures reconcile with
 * the ring above them.
 */
export async function placeBreakdown(
	db: Db,
	scope: AnalyticsScope,
	period: Period,
	now: Date,
	limit = 8
): Promise<PlaceSlice[]> {
	const lat = sql<number>`coalesce(${purchase.latE3}, ${merchant.latE3})`;
	const lng = sql<number>`coalesce(${purchase.lngE3}, ${merchant.lngE3})`;
	const key = sql<string>`coalesce(
		${merchant.id}::text,
		nullif(btrim(${purchase.placeLabel}), ''),
		'e3:' || ${lat} || ':' || ${lng}
	)`;

	const rows = await db
		.select({
			key,
			label: sql<string | null>`coalesce(${merchant.name}, max(btrim(${purchase.placeLabel})))`,
			// The centroid of the rows in the group, so a place named once and
			// pinned twice a block apart lands between its own pins rather than on
			// whichever row the planner happened to see first.
			latE3: sql<number>`round(avg(${lat}))`,
			lngE3: sql<number>`round(avg(${lng}))`,
			// The extent, so the drill-through covers every pin the row counted.
			minLatE3: sql<number>`min(${lat})`,
			maxLatE3: sql<number>`max(${lat})`,
			minLngE3: sql<number>`min(${lng})`,
			maxLngE3: sql<number>`max(${lng})`,
			total: sql<string>`sum(${purchase.finalAmountMinor})`,
			n: sql<string>`count(*)`
		})
		.from(purchase)
		.leftJoin(merchant, eq(purchase.merchantId, merchant.id))
		.where(and(spentInPeriod(scope, period, now), sql`${lat} is not null`))
		.groupBy(key, merchant.name)
		.orderBy(sql`sum(${purchase.finalAmountMinor}) desc`)
		.limit(limit);

	return rows.map((r) => ({
		key: r.key,
		// A pin nobody named is still a place you went; naming it after what it
		// lacks would make it read as a chore, the same reasoning as "Other" above.
		label: r.label ?? 'Unnamed place',
		latE3: Number(r.latE3),
		lngE3: Number(r.lngE3),
		bboxE3: {
			minLatE3: Number(r.minLatE3),
			maxLatE3: Number(r.maxLatE3),
			minLngE3: Number(r.minLngE3),
			maxLngE3: Number(r.maxLngE3)
		},
		totalMinor: BigInt(r.total),
		count: Number(r.n)
	}));
}

/** Whether this workspace has ever pinned anything the viewer can see. Drives
 *  whether the map affordance appears at all. */
export async function hasAnyPlace(db: Db, scope: AnalyticsScope, now: Date): Promise<boolean> {
	const [row] = await db
		.select({ id: purchase.id })
		.from(purchase)
		.leftJoin(merchant, eq(purchase.merchantId, merchant.id))
		.where(
			and(
				eq(purchase.workspaceId, scope.workspaceId),
				inArray(purchase.state, ['completed', 'refunded']),
				visibleTo(scope.viewerId, now),
				sql`coalesce(${purchase.latE3}, ${merchant.latE3}) is not null`
			)
		)
		.limit(1);
	return row !== undefined;
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
