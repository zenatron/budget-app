import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import {
	purchase as purchaseTable,
	workspace,
	workspaceMember,
	merchant,
	bucket,
	bucketTransaction
} from '$lib/server/db/schema';
import { Money } from '$lib/domain/money/money';
import type { ApprovalPolicy } from '$lib/domain/approval/policy';
import { approvalRequired, resolveApprovers } from '$lib/domain/approval/evaluate';
import {
	approve,
	cancel,
	complete,
	deny,
	edit,
	markRefunded,
	requestApproval,
	autoApprove,
	PurchaseStateError,
	type Purchase,
	type PurchaseEdit
} from '$lib/domain/purchase/purchase';
import {
	approversNotConcealed,
	isSealed,
	validateSeal,
	type SealSpec
} from '$lib/domain/visibility/seal';
import {
	appendEvent,
	applyTransition,
	insertPurchase,
	loadPurchase
} from '$lib/server/repo/purchases';
import type { Clock } from '$lib/ports/clock';
import type { IdGenerator } from '$lib/ports/id-generator';
import type { Notifier } from '$lib/ports/notifier';
import { announcePurchaseChange } from '$lib/application/notify-dispatch';

export class PurchaseNotFoundError extends Error {
	constructor() {
		super('Purchase not found');
		this.name = 'PurchaseNotFoundError';
	}
}

interface Deps {
	clock: Clock;
	ids: IdGenerator;
	notifier: Notifier;
}

interface Scope {
	workspaceId: string;
	/** The acting member's workspace_member id — also the seal-filter viewer. */
	memberId: string;
}

export interface SubmitPurchaseCmd {
	itemName: string;
	amount: Money;
	categoryId: string | null;
	note: string | null;
	/** 'request' = intent, not yet bought. 'log' = already spent (amount is final). */
	intent: 'request' | 'log';
	/** When intent is 'log': when the money was actually spent. */
	spentAt?: Date;
	/** Gift mode: hide this purchase entirely from these members until the date. */
	seal?: SealSpec;
	merchantName?: string | null;
	/** Charge this purchase against a bucket (withdraw on completion). */
	bucketId?: string | null;
}

/**
 * Submit a purchase. Policy decides the path:
 *  - needs approval  → PENDING_APPROVAL (a 'log' keeps its final amount so a
 *    later approval completes it in one step — retroactive approval).
 *  - exempt 'request' → APPROVED automatically (recorded as such).
 *  - exempt 'log'     → COMPLETED immediately.
 */
export async function submitPurchase(
	db: Db,
	deps: Deps,
	scope: Scope,
	cmd: SubmitPurchaseCmd
): Promise<{ purchaseId: string }> {
	const now = deps.clock.now();
	const result = await db.transaction(async (tx) => {
		const [ws] = await tx
			.select()
			.from(workspace)
			.where(eq(workspace.id, scope.workspaceId))
			.limit(1);
		if (!ws) throw new PurchaseNotFoundError();
		if (cmd.amount.currency !== ws.currency) {
			throw new PurchaseStateError(
				`This workspace uses ${ws.currency}; got ${cmd.amount.currency}`
			);
		}
		if (!cmd.amount.isPositive) {
			throw new PurchaseStateError('Amount must be positive');
		}

		let merchantId: string | null = null;
		if (cmd.merchantName) {
			const normalized = cmd.merchantName.trim().toLowerCase().replace(/\s+/g, ' ');
			if (normalized.length > 0) {
				const [existing] = await tx
					.select({ id: merchant.id })
					.from(merchant)
					.where(
						and(
							eq(merchant.workspaceId, scope.workspaceId),
							eq(merchant.normalizedName, normalized)
						)
					)
					.limit(1);
				if (existing) {
					merchantId = existing.id;
				} else {
					merchantId = deps.ids.newId();
					await tx.insert(merchant).values({
						id: merchantId,
						workspaceId: scope.workspaceId,
						name: cmd.merchantName.trim(),
						normalizedName: normalized
					});
				}
			}
		}

		const members = await tx
			.select({ id: workspaceMember.id, policy: workspaceMember.approvalPolicy })
			.from(workspaceMember)
			.where(
				and(
					eq(workspaceMember.workspaceId, scope.workspaceId),
					eq(workspaceMember.status, 'active')
				)
			);
		const me = members.find((m) => m.id === scope.memberId);
		if (!me) throw new PurchaseNotFoundError();
		const policy = me.policy as ApprovalPolicy;

		if (cmd.seal) {
			validateSeal(cmd.seal, {
				now,
				maxSealDays: ws.maxSealDays,
				requesterMemberId: scope.memberId,
				activeMemberIds: members.map((m) => m.id)
			});
		}

		// Validate bucket if provided — must be active and in this workspace.
		if (cmd.bucketId) {
			const [bkt] = await tx
				.select({ id: bucket.id, status: bucket.status, workspaceId: bucket.workspaceId })
				.from(bucket)
				.where(and(eq(bucket.id, cmd.bucketId), eq(bucket.workspaceId, scope.workspaceId)))
				.limit(1);
			if (!bkt) throw new PurchaseStateError('Bucket not found');
			if (bkt.status !== 'active')
				throw new PurchaseStateError('Cannot charge to a paused or archived bucket');
		}

		const isLog = cmd.intent === 'log';
		const draft: Purchase = {
			id: deps.ids.newId(),
			workspaceId: scope.workspaceId,
			memberId: scope.memberId,
			state: 'draft',
			itemName: cmd.itemName,
			note: cmd.note,
			categoryId: cmd.categoryId,
			requestedAmount: cmd.amount,
			approvedAmount: null,
			// A logged purchase carries its final amount from the start.
			finalAmount: isLog ? cmd.amount : null,
			sealedUntil: cmd.seal?.sealedUntil ?? null,
			sealedFromMemberIds: cmd.seal?.sealedFromMemberIds ?? [],
			requestedAt: null,
			decidedAt: null,
			completedAt: isLog ? (cmd.spentAt ?? now) : null,
			lastNudgedAt: null,
			nudgeCount: 0,
			recurringRuleId: null,
			parentPurchaseId: null,
			approverMemberIds: [],
			bucketId: cmd.bucketId ?? null,
			merchantId
		};

		const needed =
			cmd.bucketId && ws.bucketChargesSkipApproval
				? false
				: approvalRequired(policy, cmd.amount, cmd.categoryId);
		let result;
		if (needed) {
			const approvers = resolveApprovers(
				policy,
				members.map((m) => m.id)
			);
			// Approval × seal conflict: route to approvers who can see it; if
			// none can, auto-approve *with disclosure* — never a silent skip.
			const eligible = cmd.seal ? approversNotConcealed(approvers, cmd.seal) : approvers;
			if (eligible.length > 0) {
				result = requestApproval(draft, eligible, now);
			} else if (isLog) {
				const bare = { ...draft, finalAmount: null, completedAt: null };
				result = complete(
					bare,
					scope.memberId,
					{ amount: cmd.amount, at: cmd.spentAt ?? now },
					ws.reapprovalThresholdPct,
					now
				);
				result.event.reason = 'sealed: approver concealed — recorded without approval';
			} else {
				result = autoApprove(draft, now, 'sealed: approver concealed — recorded without approval');
			}
		} else if (isLog) {
			// completedAt/finalAmount already on the draft; complete() re-asserts them.
			const bare = { ...draft, finalAmount: null, completedAt: null };
			result = complete(
				bare,
				scope.memberId,
				{ amount: cmd.amount, at: cmd.spentAt ?? now },
				ws.reapprovalThresholdPct,
				now
			);
		} else {
			result = autoApprove(draft, now, 'approval not required');
		}
		await insertPurchase(tx, deps, result.purchase, result.event);
		if (result.purchase.state === 'completed' && result.purchase.bucketId) {
			await withdrawFromBucket(tx, deps, result.purchase);
		}
		if (cmd.seal) {
			// Audit the seal itself — private until unseal, not secret after it.
			await appendEvent(tx, deps.ids, result.purchase.id, {
				fromState: result.purchase.state,
				toState: result.purchase.state,
				actorMemberId: scope.memberId,
				reason: `sealed until ${cmd.seal.sealedUntil.toISOString().slice(0, 10)} (hidden from ${cmd.seal.sealedFromMemberIds.length})`,
				amountSnapshot: null,
				at: now
			});
		}
		return result;
	});
	// After commit only — a rolled-back purchase must never notify anyone.
	await announcePurchaseChange(db, deps.notifier, result.purchase, result.event);
	return { purchaseId: result.purchase.id };
}

/**
 * Record a refund as a negative child row — spending history is never deleted.
 * Partial refunds leave the parent COMPLETED; once cumulative refunds cover the
 * final amount, the parent transitions to REFUNDED. Totals stay honest because
 * analytics sums both states: parent (+X) and children (−…) net out.
 */
export async function refundPurchase(
	db: Db,
	deps: Deps,
	scope: Scope,
	purchaseId: string,
	amount: Money
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
		if (p.memberId !== scope.memberId) {
			throw new PurchaseStateError('Only the requester can record a refund');
		}
		if (p.state !== 'completed') {
			throw new PurchaseStateError('Only completed purchases can be refunded');
		}
		if (isSealed(p, now)) {
			throw new PurchaseStateError('Sealed purchases cannot be refunded until the seal opens');
		}
		if (!amount.isPositive) throw new PurchaseStateError('Refund amount must be positive');

		const [prior] = await tx
			.select({ refunded: sql<string>`coalesce(sum(${purchaseTable.finalAmountMinor}), 0)` })
			.from(purchaseTable)
			.where(eq(purchaseTable.parentPurchaseId, p.id));
		const remaining = p.finalAmount!.minor + BigInt(prior.refunded); // prior is negative
		if (amount.minor > remaining) {
			throw new PurchaseStateError(
				`Refund exceeds what is left (${Money.of(remaining, amount.currency).format()})`
			);
		}

		const child: Purchase = {
			...p,
			id: deps.ids.newId(),
			state: 'refunded',
			itemName: `Refund: ${p.itemName}`,
			note: null,
			requestedAmount: amount.negate(),
			approvedAmount: null,
			finalAmount: amount.negate(),
			sealedUntil: null,
			sealedFromMemberIds: [],
			requestedAt: null,
			decidedAt: null,
			completedAt: now,
			lastNudgedAt: null,
			nudgeCount: 0,
			recurringRuleId: null,
			parentPurchaseId: p.id,
			approverMemberIds: []
		};
		await insertPurchase(tx, deps, child, {
			fromState: null,
			toState: 'refunded',
			actorMemberId: scope.memberId,
			reason: 'refund recorded',
			amountSnapshot: amount.negate(),
			at: now
		});

		if (p.bucketId) {
			await tx.insert(bucketTransaction).values({
				id: deps.ids.newId(),
				bucketId: p.bucketId,
				amountMinor: amount.minor,
				currency: amount.currency,
				type: 'withdrawal',
				note: `Refund: ${p.itemName}`,
				createdAt: now
			});
		}

		if (amount.minor === remaining) {
			const r = markRefunded(p, scope.memberId, now);
			await applyTransition(tx, deps.ids, r.purchase, r.event);
			return r;
		}
		await appendEvent(tx, deps.ids, p.id, {
			fromState: p.state,
			toState: p.state,
			actorMemberId: scope.memberId,
			reason: `partial refund`,
			amountSnapshot: amount.negate(),
			at: now
		});
		return { purchase: p, event: null };
	});
	if (result.event) {
		await announcePurchaseChange(db, deps.notifier, result.purchase, result.event);
	}
}

/** Early unseal by the requester — the only person who may open it before time. */
export async function unsealPurchase(db: Db, deps: Deps, scope: Scope, purchaseId: string) {
	const now = deps.clock.now();
	await db
		.transaction(async (tx) => {
			const p = await loadPurchase(
				tx,
				{ workspaceId: scope.workspaceId, viewerId: scope.memberId },
				purchaseId,
				{ forUpdate: true, now }
			);
			if (!p) throw new PurchaseNotFoundError();
			if (p.memberId !== scope.memberId) {
				throw new PurchaseStateError('Only the person who sealed a purchase can unseal it early');
			}
			if (!isSealed(p, now)) throw new PurchaseStateError('This purchase is not sealed');
			const formerlyConcealed = p.sealedFromMemberIds;
			const unsealed: Purchase = { ...p, sealedFromMemberIds: [] };
			const event = unsealEvent(unsealed, scope.memberId, formerlyConcealed, now);
			await applyTransition(tx, deps.ids, unsealed, event);
			return { purchase: unsealed, event };
		})
		.then((r) => announcePurchaseChange(db, deps.notifier, r.purchase, r.event));
}

export function unsealEvent(
	p: Purchase,
	actorMemberId: string | null,
	formerlyConcealed: string[],
	now: Date
) {
	return {
		fromState: p.state,
		toState: p.state,
		actorMemberId,
		reason: 'seal opened',
		amountSnapshot: null,
		at: now,
		sealOpenedRecipients: formerlyConcealed
	};
}

async function withPurchase(
	db: Db,
	deps: Deps,
	scope: Scope,
	purchaseId: string,
	fn: (p: Purchase, thresholdPct: number) => ReturnType<typeof approve>,
	after?: (tx: Db, deps: Deps, purchase: Purchase) => Promise<void>
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
		const [ws] = await tx
			.select({ pct: workspace.reapprovalThresholdPct })
			.from(workspace)
			.where(eq(workspace.id, scope.workspaceId))
			.limit(1);
		const r = fn(p, ws.pct);
		await applyTransition(tx, deps.ids, r.purchase, r.event);
		if (r.purchase.state === 'completed' && r.purchase.bucketId && after) {
			await after(tx, deps, r.purchase);
		}
		return r;
	});
	await announcePurchaseChange(db, deps.notifier, result.purchase, result.event);
}

export async function approvePurchase(db: Db, deps: Deps, scope: Scope, purchaseId: string) {
	await withPurchase(db, deps, scope, purchaseId, (p) =>
		approve(p, scope.memberId, deps.clock.now())
	);
}

export async function denyPurchase(
	db: Db,
	deps: Deps,
	scope: Scope,
	purchaseId: string,
	reason: string | null
) {
	await withPurchase(db, deps, scope, purchaseId, (p) =>
		deny(p, scope.memberId, reason, deps.clock.now())
	);
}

export async function cancelPurchase(db: Db, deps: Deps, scope: Scope, purchaseId: string) {
	await withPurchase(db, deps, scope, purchaseId, (p) =>
		cancel(p, scope.memberId, deps.clock.now())
	);
}

export async function completePurchase(
	db: Db,
	deps: Deps,
	scope: Scope,
	purchaseId: string,
	final: { amount: Money; at: Date }
) {
	await withPurchase(
		db,
		deps,
		scope,
		purchaseId,
		(p, pct) => complete(p, scope.memberId, final, pct, deps.clock.now()),
		withdrawFromBucket
	);
}

export async function editPurchase(
	db: Db,
	deps: Deps,
	scope: Scope,
	purchaseId: string,
	changes: PurchaseEdit
) {
	await withPurchase(db, deps, scope, purchaseId, (p) =>
		edit(p, scope.memberId, changes, deps.clock.now())
	);
}

async function withdrawFromBucket(tx: Db, deps: Deps, p: Purchase): Promise<void> {
	if (!p.bucketId || !p.finalAmount) return;
	const amountMinor = -p.finalAmount.minor;
	if (amountMinor >= 0n) return;
	await tx.insert(bucketTransaction).values({
		id: deps.ids.newId(),
		bucketId: p.bucketId,
		amountMinor,
		currency: p.finalAmount.currency,
		type: 'withdrawal',
		note: p.itemName,
		createdAt: p.completedAt ?? deps.clock.now()
	});
}
