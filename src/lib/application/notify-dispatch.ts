import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { user, workspace, workspaceMember } from '$lib/server/db/schema';
import type { Purchase, TransitionEvent } from '$lib/domain/purchase/purchase';
import { publish } from '$lib/infra/events/bus';
import type { NotificationEventType, Notifier, Recipient } from '$lib/ports/notifier';

/**
 * Post-commit fan-out for a purchase transition: one SSE publish (seal-filtered
 * per subscriber by the bus) plus channel notifications to the right people.
 * Recipient selection is seal-safe by construction: approvers come from the
 * seal-filtered snapshot, the requester owns the purchase, and 'seal opened'
 * only fires once the seal no longer conceals anyone.
 */
export async function announcePurchaseChange(
	db: Db,
	notifier: Notifier,
	p: Purchase,
	ev: TransitionEvent
): Promise<void> {
	publish(
		p.workspaceId,
		{
			type: 'purchase',
			purchaseId: p.id,
			sealedUntil: p.sealedUntil,
			sealedFromMemberIds: p.sealedFromMemberIds
		},
		ev.at
	);

	const plan = planNotification(p, ev);
	if (!plan) return;

	try {
		const [ws] = await db
			.select({ slug: workspace.slug })
			.from(workspace)
			.where(eq(workspace.id, p.workspaceId))
			.limit(1);

		const memberIds = [
			...new Set([...plan.recipientMemberIds, p.memberId, ev.actorMemberId ?? p.memberId])
		];
		const members = await db
			.select({
				memberId: workspaceMember.id,
				userId: workspaceMember.userId,
				name: user.displayName
			})
			.from(workspaceMember)
			.innerJoin(user, eq(workspaceMember.userId, user.id))
			.where(
				and(eq(workspaceMember.workspaceId, p.workspaceId), inArray(workspaceMember.id, memberIds))
			);
		const byId = new Map(members.map((m) => [m.memberId, m]));

		const recipients: Recipient[] = plan.recipientMemberIds
			.map((id) => byId.get(id))
			.filter((m) => m !== undefined)
			.map((m) => ({ userId: m.userId, memberId: m.memberId }));
		if (recipients.length === 0) return;

		const amount = (p.finalAmount ?? p.approvedAmount ?? p.requestedAmount).format();
		const requesterName = byId.get(p.memberId)?.name ?? 'Someone';
		const actorName = ev.actorMemberId ? (byId.get(ev.actorMemberId)?.name ?? 'Someone') : null;

		await notifier.notify(recipients, plan.eventType, {
			title: plan.title(requesterName, actorName),
			body: `${p.itemName} · ${amount}`,
			path: `/w/${ws.slug}/purchases/${p.id}`,
			tag: p.id
		});
	} catch (e) {
		console.log(
			JSON.stringify({ level: 'error', msg: 'notify: announce failed', err: (e as Error).message })
		);
	}
}

interface NotificationPlan {
	eventType: NotificationEventType;
	recipientMemberIds: string[];
	title: (requesterName: string, actorName: string | null) => string;
}

function planNotification(p: Purchase, ev: TransitionEvent): NotificationPlan | null {
	const notRequester = (id: string) => id !== p.memberId;

	if (ev.reason === 'seal opened') {
		// Everyone previously concealed may now see it; tell the approver
		// snapshot plus nobody else knows better — announce to all approvers
		// and let the requester's own action speak for itself. Workspace-wide
		// announce happens through SSE; push goes to the formerly concealed.
		return {
			eventType: 'seal_opened',
			recipientMemberIds: ev.sealOpenedRecipients ?? [],
			title: (requester) => `${requester} revealed a sealed purchase`
		};
	}

	if (ev.toState === 'pending_approval') {
		const overage = ev.reason === 'overage';
		const edited = ev.reason === 'edited after approval';
		return {
			eventType: 'approval_requested',
			recipientMemberIds: p.approverMemberIds.filter(notRequester),
			title: (requester) =>
				overage
					? `${requester} overspent — needs re-approval`
					: edited
						? `${requester} changed a purchase — needs re-approval`
						: `${requester} requested approval`
		};
	}

	if (ev.toState === 'approved' && ev.actorMemberId && ev.actorMemberId !== p.memberId) {
		return {
			eventType: 'approval_decided',
			recipientMemberIds: [p.memberId],
			title: (_, actor) => `${actor} approved`
		};
	}

	if (ev.toState === 'denied' && ev.actorMemberId && ev.actorMemberId !== p.memberId) {
		return {
			eventType: 'approval_decided',
			recipientMemberIds: [p.memberId],
			title: (_, actor) => `${actor} denied`
		};
	}

	if (
		ev.toState === 'completed' &&
		ev.reason === 'overage approved' &&
		ev.actorMemberId &&
		ev.actorMemberId !== p.memberId
	) {
		return {
			eventType: 'approval_decided',
			recipientMemberIds: [p.memberId],
			title: (_, actor) => `${actor} approved the overage`
		};
	}

	return null;
}
