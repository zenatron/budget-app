import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/pg-core';
import type { Db } from '$lib/server/db';
import { bucket, bucketTransaction, purchase } from '$lib/server/db/schema';
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

export interface LedgerOpts {
	search?: string;
	categoryId?: string;
	/** Bucket movements are off unless asked for. */
	includeMovements?: boolean;
	limit?: number;
	offset?: number;
}

/** Purchases sort by when they happened, falling back through their lifecycle. */
const purchaseAt = sql`coalesce(${purchase.completedAt}, ${purchase.requestedAt}, ${purchase.createdAt})`;

export async function listLedger(
	db: Db,
	scope: { workspaceId: string; viewerId: string },
	now: Date,
	opts: LedgerOpts = {}
): Promise<{ entries: LedgerEntry[]; hasMore: boolean }> {
	const limit = opts.limit ?? 20;
	const offset = opts.offset ?? 0;

	const purchaseWhere: SQL[] = [
		eq(purchase.workspaceId, scope.workspaceId),
		visibleTo(scope.viewerId, now)
	];
	if (opts.search) purchaseWhere.push(ilike(purchase.itemName, `%${opts.search}%`));
	if (opts.categoryId) purchaseWhere.push(eq(purchase.categoryId, opts.categoryId));

	const purchaseKeys = db
		.select({
			kind: sql<string>`'purchase'`.as('kind'),
			id: purchase.id,
			at: sql<string>`${purchaseAt}`.as('at')
		})
		.from(purchase)
		.where(and(...purchaseWhere));

	// A movement has no category, so a category filter excludes them by
	// construction rather than by an extra flag.
	const wantMovements = opts.includeMovements && !opts.categoryId;

	let keys: { kind: string; id: string; at: string }[];
	if (wantMovements) {
		const movementWhere: SQL[] = [eq(bucket.workspaceId, scope.workspaceId)];
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
