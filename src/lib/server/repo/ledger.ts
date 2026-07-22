import { and, desc, eq, gte, ilike, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import type { Db } from '$lib/server/db';
import { bucket, bucketTransaction, merchant, purchase } from '$lib/server/db/schema';
import { listPurchases, visibleTo, type PurchaseListItem } from './purchases';

/**
 * The ledger: purchases and bucket movements on one timeline.
 *
 * Movements are a different kind of event — an accrual isn't spending, it's your
 * own money moving sideways — so they're opt-in, and the caller renders them
 * subordinate. Purchases stay the default reading of the page.
 *
 * Paged across both kinds via a union of (kind, id, date), which is then
 * hydrated. Fetching each kind separately and merging in memory would page each
 * one independently and drop rows at the boundaries.
 */

export interface BucketMovementItem {
	id: string;
	at: Date;
	bucketId: string;
	bucketName: string;
	bucketColor: string | null;
	type: 'accrual' | 'withdrawal' | 'adjustment';
	amountMinor: bigint;
	currency: string;
	note: string | null;
}

export type LedgerEntry =
	({ kind: 'purchase' } & PurchaseListItem) | ({ kind: 'movement' } & BucketMovementItem);

/**
 * Which reading of "in this window" a date filter means.
 *
 * `activity` — anything that happened, dated by when it last moved. What you
 * want when you pick a range by hand: pending requests and refusals are things
 * that happened in that week, and hiding them would make the ledger lie.
 *
 * `spend` — money actually spent, dated by `completedAt`, counting only the
 * states analytics counts. This is the basis every figure on the analytics page
 * is computed on, so drilling into one of those figures must use it or the rows
 * won't sum to the number that was tapped. See `spentInPeriod` in
 * repo/analytics.ts — the two predicates are deliberately the same shape.
 */
export type LedgerBasis = 'activity' | 'spend';

export interface LedgerOpts {
	search?: string;
	categoryId?: string;
	/** Sentinel for "has no category" — the rows analytics shows as "Other". */
	uncategorized?: boolean;
	memberId?: string;
	/** Instants, half-open [from, to). Convert from calendar dates with
	 *  periodBoundsUtc so the boundary matches the analytics page exactly. */
	from?: Date;
	to?: Date;
	basis?: LedgerBasis;
	/** Bucket movements are off unless asked for. */
	includeMovements?: boolean;
	limit?: number;
	offset?: number;
}

/** Purchases sort by when they happened, falling back through their lifecycle. */
const purchaseAt = sql`coalesce(${purchase.completedAt}, ${purchase.decidedAt}, ${purchase.requestedAt}, ${purchase.createdAt})`;

export async function listLedger(
	db: Db,
	scope: { workspaceId: string; viewerId: string },
	now: Date,
	opts: LedgerOpts = {}
): Promise<{ entries: LedgerEntry[]; hasMore: boolean }> {
	const limit = opts.limit ?? 20;
	const offset = opts.offset ?? 0;

	const basis = opts.basis ?? 'activity';

	const purchaseWhere: SQL[] = [
		eq(purchase.workspaceId, scope.workspaceId),
		visibleTo(scope.viewerId, now)
	];
	// Match the item name or the merchant it was bought from — the merchant is
	// left-joined below so this OR can see merchant.name.
	if (opts.search) {
		purchaseWhere.push(
			or(
				ilike(purchase.itemName, `%${opts.search}%`),
				ilike(merchant.name, `%${opts.search}%`)
			)!
		);
	}
	if (opts.categoryId) purchaseWhere.push(eq(purchase.categoryId, opts.categoryId));
	if (opts.uncategorized) purchaseWhere.push(isNull(purchase.categoryId));
	if (opts.memberId) purchaseWhere.push(eq(purchase.memberId, opts.memberId));

	// On the spend basis a row is dated by when it completed, and only settled
	// states count — matching analytics exactly. On the activity basis a row is
	// dated by whenever it last moved, whatever state it reached.
	if (basis === 'spend') {
		purchaseWhere.push(inArray(purchase.state, ['completed', 'refunded']));
		if (opts.from) purchaseWhere.push(gte(purchase.completedAt, opts.from));
		if (opts.to) purchaseWhere.push(lt(purchase.completedAt, opts.to));
	} else {
		// purchaseAt is an expression, not a column, so there's no timestamptz
		// mapper to bind a Date through (gte()/lt() rely on the column for that).
		// A bare `${opts.from}` here serializes the Date via Date.toString() —
		// "Mon Jun 15 2026 …" — which Postgres can't parse as timestamptz, so the
		// whole query 500s. Send an ISO string and cast it explicitly instead.
		// This is the only date path a manual ledger filter takes (basis=activity);
		// analytics drill-throughs pin basis=spend and hit the gte() path above,
		// which is why the bug only surfaced when filtering by hand.
		if (opts.from)
			purchaseWhere.push(sql`${purchaseAt} >= ${opts.from.toISOString()}::timestamptz`);
		if (opts.to) purchaseWhere.push(sql`${purchaseAt} < ${opts.to.toISOString()}::timestamptz`);
	}

	const purchaseKeys = db
		.select({
			kind: sql<string>`'purchase'`.as('kind'),
			id: purchase.id,
			at: sql<string>`${purchaseAt}`.as('at')
		})
		.from(purchase)
		.leftJoin(merchant, eq(purchase.merchantId, merchant.id))
		.where(and(...purchaseWhere));

	/*
	 * A movement has no category and no member, so those filters exclude them by
	 * construction rather than by an extra flag. The spend basis excludes them
	 * too: moving your own money sideways isn't spending, and analytics never
	 * counts it — so a drill-through that showed movements would list rows that
	 * aren't part of the total you tapped.
	 */
	const wantMovements =
		opts.includeMovements &&
		!opts.categoryId &&
		!opts.uncategorized &&
		!opts.memberId &&
		basis !== 'spend';

	let keys: { kind: string; id: string; at: string }[];
	if (wantMovements) {
		const movementWhere: SQL[] = [eq(bucket.workspaceId, scope.workspaceId)];
		if (opts.from) movementWhere.push(gte(bucketTransaction.createdAt, opts.from));
		if (opts.to) movementWhere.push(lt(bucketTransaction.createdAt, opts.to));
		if (opts.search) {
			movementWhere.push(
				or(
					ilike(bucket.name, `%${opts.search}%`),
					ilike(bucketTransaction.note, `%${opts.search}%`)
				)!
			);
		}
		const movementKeys = db
			.select({
				kind: sql<string>`'movement'`.as('kind'),
				id: bucketTransaction.id,
				at: sql<string>`${bucketTransaction.createdAt}`.as('at')
			})
			.from(bucketTransaction)
			.innerJoin(bucket, eq(bucketTransaction.bucketId, bucket.id))
			.where(and(...movementWhere));

		keys = await unionAll(purchaseKeys, movementKeys)
			.orderBy(sql`at desc`)
			.limit(limit + 1)
			.offset(offset);
	} else {
		keys = await purchaseKeys
			.orderBy(desc(sql`at`))
			.limit(limit + 1)
			.offset(offset);
	}

	const hasMore = keys.length > limit;
	const page = hasMore ? keys.slice(0, limit) : keys;

	const purchaseIds = page.filter((k) => k.kind === 'purchase').map((k) => k.id);
	const movementIds = page.filter((k) => k.kind === 'movement').map((k) => k.id);

	const [purchases, movements] = await Promise.all([
		listPurchases(db, scope, now, { ids: purchaseIds }),
		listBucketMovements(db, movementIds)
	]);

	const byId = new Map<string, LedgerEntry>();
	for (const p of purchases) byId.set(p.id, { kind: 'purchase', ...p });
	for (const m of movements) byId.set(m.id, { kind: 'movement', ...m });

	// The union decided the order; hydration only filled in the detail.
	return { entries: page.map((k) => byId.get(k.id)).filter((e): e is LedgerEntry => !!e), hasMore };
}

async function listBucketMovements(db: Db, ids: string[]): Promise<BucketMovementItem[]> {
	if (ids.length === 0) return [];
	const rows = await db
		.select({
			id: bucketTransaction.id,
			at: bucketTransaction.createdAt,
			bucketId: bucketTransaction.bucketId,
			bucketName: bucket.name,
			bucketColor: bucket.color,
			type: bucketTransaction.type,
			amountMinor: bucketTransaction.amountMinor,
			currency: bucketTransaction.currency,
			note: bucketTransaction.note
		})
		.from(bucketTransaction)
		.innerJoin(bucket, eq(bucketTransaction.bucketId, bucket.id))
		.where(inArray(bucketTransaction.id, ids));
	return rows;
}
