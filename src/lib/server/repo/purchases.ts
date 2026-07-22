import { and, desc, eq, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { alias, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Db } from '$lib/server/db';
import {
	approvalEvent,
	category,
	merchant,
	purchase,
	purchaseApprover,
	purchaseImage,
	user,
	workspaceMember
} from '$lib/server/db/schema';
import { Money } from '$lib/domain/money/money';
import type { Purchase, TransitionEvent } from '$lib/domain/purchase/purchase';
import type { Clock } from '$lib/ports/clock';
import type { IdGenerator } from '$lib/ports/id-generator';

/**
 * Every read takes (workspaceId, viewerId) and applies the seal filter in the
 * query. For a concealed viewer a sealed purchase does not exist — not in
 * lists, not in details, not in aggregates. This predicate is the single
 * enforcement point; add it to every new purchase query.
 */
export function visibleTo(viewerId: string, now: Date): SQL {
	return sealOpenTo(purchase, viewerId, now);
}

/**
 * The seal predicate, against any alias of the purchase table. Refund rows
 * borrow their parent's photo, and the parent has to pass this check on its own
 * — inheriting an image must not become a way to see a concealed purchase.
 */
function sealOpenTo(
	// AnyPgColumn, not `typeof purchase`: an alias bakes its own table name into
	// the column types, so the concrete table type won't accept one.
	t: { sealedFromMemberIds: AnyPgColumn; sealedUntil: AnyPgColumn },
	viewerId: string,
	now: Date
): SQL {
	return or(
		sql`not (${t.sealedFromMemberIds} @> array[${viewerId}]::uuid[])`,
		// lte, not raw sql: it binds through the column's timestamptz mapping.
		// Interpolating the Date directly sends Date.toString(), which Postgres
		// cannot parse — that broke every seal-filtered read.
		lte(t.sealedUntil, now)
	)!;
}

export type PurchaseRow = typeof purchase.$inferSelect;

export function mapPurchaseRow(row: PurchaseRow, approverMemberIds: string[]): Purchase {
	return toDomain(row, approverMemberIds);
}

function toDomain(row: PurchaseRow, approverMemberIds: string[]): Purchase {
	return {
		id: row.id,
		workspaceId: row.workspaceId,
		memberId: row.memberId,
		state: row.state,
		itemName: row.itemName,
		note: row.note,
		categoryId: row.categoryId,
		merchantId: row.merchantId,
		requestedAmount: Money.of(row.requestedAmountMinor, row.currency),
		approvedAmount:
			row.approvedAmountMinor === null ? null : Money.of(row.approvedAmountMinor, row.currency),
		finalAmount:
			row.finalAmountMinor === null ? null : Money.of(row.finalAmountMinor, row.currency),
		sealedUntil: row.sealedUntil,
		sealedFromMemberIds: row.sealedFromMemberIds,
		requestedAt: row.requestedAt,
		decidedAt: row.decidedAt,
		completedAt: row.completedAt,
		lastNudgedAt: row.lastNudgedAt,
		nudgeCount: row.nudgeCount,
		recurringRuleId: row.recurringRuleId,
		parentPurchaseId: row.parentPurchaseId,
		approverMemberIds,
		bucketId: row.bucketId ?? null,
		heldUntil: row.heldUntil,
		heldBy: row.heldBy
	};
}

/** Load one purchase as a domain object, seal-filtered, locked FOR UPDATE when in a tx. */
export async function loadPurchase(
	db: Db,
	scope: { workspaceId: string; viewerId: string },
	purchaseId: string,
	opts: { forUpdate?: boolean; now: Date }
): Promise<Purchase | null> {
	let q = db
		.select()
		.from(purchase)
		.where(
			and(
				eq(purchase.id, purchaseId),
				eq(purchase.workspaceId, scope.workspaceId),
				visibleTo(scope.viewerId, opts.now)
			)
		)
		.limit(1)
		.$dynamic();
	if (opts.forUpdate) q = q.for('update');
	const rows = await q;
	if (!rows[0]) return null;
	const approvers = await db
		.select({ memberId: purchaseApprover.memberId })
		.from(purchaseApprover)
		.where(eq(purchaseApprover.purchaseId, purchaseId));
	return toDomain(
		rows[0],
		approvers.map((a) => a.memberId)
	);
}

/**
 * Insert a freshly created purchase plus its approver snapshot and first event.
 *
 * Writes three tables and does not open its own transaction — pass a `tx`. A
 * bare `Db` here can leave a purchase with no approvers or no opening event.
 */
export async function insertPurchase(
	db: Db,
	deps: { ids: IdGenerator; clock: Clock },
	p: Purchase,
	firstEvent: TransitionEvent
): Promise<void> {
	const now = deps.clock.now();
	await db.insert(purchase).values({
		id: p.id,
		workspaceId: p.workspaceId,
		memberId: p.memberId,
		state: p.state,
		itemName: p.itemName,
		note: p.note,
		categoryId: p.categoryId,
		merchantId: p.merchantId,
		requestedAmountMinor: p.requestedAmount.minor,
		approvedAmountMinor: p.approvedAmount?.minor ?? null,
		finalAmountMinor: p.finalAmount?.minor ?? null,
		currency: p.requestedAmount.currency,
		sealedUntil: p.sealedUntil,
		sealedFromMemberIds: p.sealedFromMemberIds,
		requestedAt: p.requestedAt,
		decidedAt: p.decidedAt,
		completedAt: p.completedAt,
		lastNudgedAt: p.lastNudgedAt,
		nudgeCount: p.nudgeCount,
		recurringRuleId: p.recurringRuleId,
		parentPurchaseId: p.parentPurchaseId,
		bucketId: p.bucketId,
		heldUntil: p.heldUntil,
		heldBy: p.heldBy,
		createdAt: now,
		updatedAt: now
	});
	if (p.approverMemberIds.length > 0) {
		await db.insert(purchaseApprover).values(
			p.approverMemberIds.map((memberId) => ({
				purchaseId: p.id,
				memberId,
				isRequired: false
			}))
		);
	}
	await insertEvent(db, deps.ids, p.id, firstEvent);
}

/** Persist a domain transition: updated snapshot + append-only event. */
export async function applyTransition(
	db: Db,
	ids: IdGenerator,
	p: Purchase,
	ev: TransitionEvent
): Promise<void> {
	await db
		.update(purchase)
		.set({
			state: p.state,
			itemName: p.itemName,
			note: p.note,
			categoryId: p.categoryId,
			requestedAmountMinor: p.requestedAmount.minor,
			approvedAmountMinor: p.approvedAmount?.minor ?? null,
			finalAmountMinor: p.finalAmount?.minor ?? null,
			sealedUntil: p.sealedUntil,
			sealedFromMemberIds: p.sealedFromMemberIds,
			requestedAt: p.requestedAt,
			decidedAt: p.decidedAt,
			completedAt: p.completedAt,
			lastNudgedAt: p.lastNudgedAt,
			nudgeCount: p.nudgeCount,
			bucketId: p.bucketId,
			heldUntil: p.heldUntil,
			heldBy: p.heldBy,
			updatedAt: ev.at
		})
		.where(eq(purchase.id, p.id));
	await insertEvent(db, ids, p.id, ev);
}

export async function appendEvent(
	db: Db,
	ids: IdGenerator,
	purchaseId: string,
	ev: TransitionEvent
) {
	await insertEvent(db, ids, purchaseId, ev);
}

async function insertEvent(db: Db, ids: IdGenerator, purchaseId: string, ev: TransitionEvent) {
	await db.insert(approvalEvent).values({
		id: ids.newId(),
		purchaseId,
		actorMemberId: ev.actorMemberId,
		fromState: ev.fromState,
		toState: ev.toState,
		reason: ev.reason,
		amountSnapshotMinor: ev.amountSnapshot?.minor ?? null,
		createdAt: ev.at
	});
}

export interface PurchaseListItem {
	id: string;
	itemName: string;
	note: string | null;
	merchantName: string | null;
	state: PurchaseRow['state'];
	amountMinor: bigint;
	currency: string;
	requesterMemberId: string;
	requesterName: string;
	categoryName: string | null;
	categoryIcon: string | null;
	categoryColor: string | null;
	categoryId: string | null;
	thumbBlobId: string | null;
	requestedAt: Date | null;
	decidedAt: Date | null;
	completedAt: Date | null;
	createdAt: Date;
	canDecide: boolean;
	/** Seal still in force (viewer is necessarily not concealed, or they wouldn't see the row). */
	sealed: boolean;
	sealedUntil: Date | null;
	recurring: boolean;
	/** Child row reversing a completed purchase; its photo is the original's. */
	isRefund: boolean;
	/** Set while the purchase is asleep ("sleep on it"); when the pause lifts. */
	heldUntil: Date | null;
}

/** Workspace purchase feed, seal-filtered, pending first then newest. */
export async function listPurchases(
	db: Db,
	scope: { workspaceId: string; viewerId: string },
	now: Date,
	opts?: {
		search?: string;
		categoryId?: string;
		limit?: number;
		offset?: number;
		/** Hydrate exactly these, in no particular order — used by the ledger feed,
		 *  which decides ordering and paging across purchases and bucket moves. */
		ids?: string[];
	}
): Promise<PurchaseListItem[]> {
	if (opts?.ids && opts.ids.length === 0) return [];
	const conditions: SQL[] = [
		eq(purchase.workspaceId, scope.workspaceId),
		visibleTo(scope.viewerId, now)
	];
	if (opts?.ids) conditions.push(inArray(purchase.id, opts.ids));
	if (opts?.search) conditions.push(ilike(purchase.itemName, `%${opts.search}%`));
	if (opts?.categoryId) conditions.push(eq(purchase.categoryId, opts.categoryId));

	// A refund is a child row with no photo of its own; show the original's.
	const parentPurchase = alias(purchase, 'parent_purchase');
	const parentImage = alias(purchaseImage, 'parent_image');

	const rows = await db
		.select({
			p: purchase,
			requesterName: user.displayName,
			categoryName: category.name,
			categoryIcon: category.icon,
			categoryColor: category.color,
			merchantName: merchant.name,
			thumbBlobId: sql<
				string | null
			>`coalesce(${purchaseImage.thumbBlobId}, ${parentImage.thumbBlobId})`,
			canDecide: sql<boolean>`exists (
				select 1 from ${purchaseApprover}
				where ${purchaseApprover.purchaseId} = ${purchase.id}
				and ${purchaseApprover.memberId} = ${scope.viewerId}
			)`
		})
		.from(purchase)
		.innerJoin(workspaceMember, eq(purchase.memberId, workspaceMember.id))
		.innerJoin(user, eq(workspaceMember.userId, user.id))
		.leftJoin(category, eq(purchase.categoryId, category.id))
		.leftJoin(merchant, eq(purchase.merchantId, merchant.id))
		.leftJoin(
			purchaseImage,
			and(eq(purchaseImage.purchaseId, purchase.id), eq(purchaseImage.position, 0))
		)
		.leftJoin(
			parentPurchase,
			and(
				eq(purchase.parentPurchaseId, parentPurchase.id),
				sealOpenTo(parentPurchase, scope.viewerId, now)
			)
		)
		.leftJoin(
			parentImage,
			and(eq(parentImage.purchaseId, parentPurchase.id), eq(parentImage.position, 0))
		)
		.where(and(...conditions))
		.orderBy(
			desc(sql`${purchase.state} = 'pending_approval'`),
			desc(sql`coalesce(${purchase.completedAt}, ${purchase.requestedAt}, ${purchase.createdAt})`)
		)
		.limit(opts?.ids ? opts.ids.length : (opts?.limit ?? 20))
		.offset(opts?.ids ? 0 : (opts?.offset ?? 0));
	return rows.map((r) => ({
		id: r.p.id,
		itemName: r.p.itemName,
		note: r.p.note,
		merchantName: r.merchantName,
		state: r.p.state,
		amountMinor: r.p.finalAmountMinor ?? r.p.requestedAmountMinor,
		currency: r.p.currency,
		requesterMemberId: r.p.memberId,
		requesterName: r.requesterName,
		categoryName: r.categoryName,
		categoryIcon: r.categoryIcon,
		categoryColor: r.categoryColor,
		categoryId: r.p.categoryId,
		thumbBlobId: r.thumbBlobId,
		requestedAt: r.p.requestedAt,
		decidedAt: r.p.decidedAt,
		completedAt: r.p.completedAt,
		createdAt: r.p.createdAt,
		canDecide: r.canDecide,
		sealed:
			r.p.sealedFromMemberIds.length > 0 &&
			r.p.sealedUntil !== null &&
			r.p.sealedUntil.getTime() > now.getTime(),
		sealedUntil: r.p.sealedUntil,
		isRefund: r.p.parentPurchaseId !== null,
		recurring: r.p.recurringRuleId !== null,
		heldUntil: r.p.heldUntil
	}));
}

export interface PurchaseEventView {
	toState: PurchaseRow['state'];
	fromState: PurchaseRow['state'] | null;
	actorName: string | null;
	reason: string | null;
	amountMinor: bigint | null;
	at: Date;
}

export async function listEvents(db: Db, purchaseId: string): Promise<PurchaseEventView[]> {
	const rows = await db
		.select({
			e: approvalEvent,
			actorName: user.displayName
		})
		.from(approvalEvent)
		.leftJoin(workspaceMember, eq(approvalEvent.actorMemberId, workspaceMember.id))
		.leftJoin(user, eq(workspaceMember.userId, user.id))
		.where(eq(approvalEvent.purchaseId, purchaseId))
		.orderBy(approvalEvent.createdAt);
	return rows.map((r) => ({
		toState: r.e.toState,
		fromState: r.e.fromState,
		actorName: r.actorName,
		reason: r.e.reason,
		amountMinor: r.e.amountSnapshotMinor,
		at: r.e.createdAt
	}));
}

/** Display names for a set of member ids (approver chips on the detail page). */
export async function memberNames(db: Db, memberIds: string[]): Promise<Map<string, string>> {
	if (memberIds.length === 0) return new Map();
	const rows = await db
		.select({ id: workspaceMember.id, name: user.displayName })
		.from(workspaceMember)
		.innerJoin(user, eq(workspaceMember.userId, user.id))
		.where(inArray(workspaceMember.id, memberIds));
	return new Map(rows.map((r) => [r.id, r.name]));
}
