import { eq } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { purchase as purchaseTable } from '$lib/server/db/schema';
import {
	hold,
	extendHold,
	wake,
	letGo,
	PurchaseStateError,
	type Purchase
} from '$lib/domain/purchase/purchase';
import { applyTransition, loadPurchase } from '$lib/server/repo/purchases';
import { announcePurchaseChange } from '$lib/application/notify-dispatch';
import { PurchaseNotFoundError } from '$lib/application/purchases';
import type { Clock } from '$lib/ports/clock';
import type { IdGenerator } from '$lib/ports/id-generator';
import type { Notifier } from '$lib/ports/notifier';

interface Deps {
	clock: Clock;
	ids: IdGenerator;
	notifier: Notifier;
}

interface Scope {
	workspaceId: string;
	memberId: string;
}

/** Either side of the request may pause, wake, extend, or drop it. */
function involved(p: Purchase, memberId: string): boolean {
	return p.memberId === memberId || p.approverMemberIds.includes(memberId);
}

/** The shared shape: load-lock, check involvement, apply a held transition, notify. */
async function transition(
	db: Db,
	deps: Deps,
	scope: Scope,
	purchaseId: string,
	fn: (p: Purchase, now: Date) => ReturnType<typeof hold>,
	// Reset the "ready" nudge so a fresh pause (or extension) rings again on time.
	clearNudge: boolean
): Promise<void> {
	const now = deps.clock.now();
	const result = await db.transaction(async (tx) => {
		const p = await loadPurchase(
			tx,
			{ workspaceId: scope.workspaceId, viewerId: scope.memberId },
			purchaseId,
			{ forUpdate: true, now }
		);
		if (!p) throw new PurchaseNotFoundError();
		if (!involved(p, scope.memberId)) {
			throw new PurchaseStateError('Only the requester or an approver can do that');
		}
		const r = fn(p, now);
		await applyTransition(tx, deps.ids, r.purchase, r.event);
		if (clearNudge) {
			await tx
				.update(purchaseTable)
				.set({ heldNotifiedAt: null })
				.where(eq(purchaseTable.id, purchaseId));
		}
		return r;
	});
	await announcePurchaseChange(db, deps.notifier, result.purchase, result.event);
}

/** Put a pending request to sleep until `until`. */
export function holdPurchase(db: Db, deps: Deps, scope: Scope, purchaseId: string, until: Date) {
	return transition(
		db,
		deps,
		scope,
		purchaseId,
		(p, now) => hold(p, scope.memberId, until, now),
		true
	);
}

/** Give a sleeping request a few more days. */
export function extendHoldPurchase(
	db: Db,
	deps: Deps,
	scope: Scope,
	purchaseId: string,
	until: Date
) {
	return transition(
		db,
		deps,
		scope,
		purchaseId,
		(p, now) => extendHold(p, scope.memberId, until, now),
		true
	);
}

/** Still want it — back into the approval queue, clock restarted. */
export function wakePurchase(db: Db, deps: Deps, scope: Scope, purchaseId: string) {
	return transition(db, deps, scope, purchaseId, (p, now) => wake(p, scope.memberId, now), false);
}

/** Let it go — the quiet win. */
export function letGoPurchase(db: Db, deps: Deps, scope: Scope, purchaseId: string) {
	return transition(db, deps, scope, purchaseId, (p, now) => letGo(p, scope.memberId, now), false);
}
