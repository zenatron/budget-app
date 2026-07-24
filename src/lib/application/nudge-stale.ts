import { and, eq, lt, sql } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import {
	purchase,
	purchaseApprover,
	user,
	workspace,
	workspaceMember
} from '$lib/server/db/schema';
import { Money } from '$lib/domain/money/money';
import { nextNudgeAt, waitingDays } from '$lib/domain/approval/staleness';
import type { Clock } from '$lib/ports/clock';
import type { Notifier, Recipient } from '$lib/ports/notifier';

/**
 * Nudge approvers about stale pending requests: first nudge at the staleness
 * threshold, then daily, capped at MAX_NUDGES — then silence (a nagging app
 * gets its notifications disabled). State lives on the purchase row
 * (last_nudged_at, nudge_count); staleness itself is always derived.
 */
export async function nudgeStaleRequests(
	db: Db,
	deps: { clock: Clock; notifier: Notifier }
): Promise<number> {
	const now = deps.clock.now();
	const rows = await db
		.select({
			p: purchase,
			staleAfterHours: workspace.staleAfterHours,
			maxNudges: workspace.maxNudges,
			slug: workspace.slug,
			requesterName: user.displayName
		})
		.from(purchase)
		.innerJoin(workspace, eq(purchase.workspaceId, workspace.id))
		.innerJoin(workspaceMember, eq(purchase.memberId, workspaceMember.id))
		.innerJoin(user, eq(workspaceMember.userId, user.id))
		.where(
			and(eq(purchase.state, 'pending_approval'), lt(purchase.nudgeCount, workspace.maxNudges))
		);

	let nudged = 0;
	for (const row of rows) {
		if (!row.p.requestedAt) continue;
		const due = nextNudgeAt(
			row.p.requestedAt,
			row.staleAfterHours,
			row.p.lastNudgedAt,
			row.p.nudgeCount,
			row.maxNudges
		);
		if (due === null || due.getTime() > now.getTime()) continue;

		// Optimistic claim: only one sweep instance wins this nudge.
		const claimed = await db
			.update(purchase)
			.set({ lastNudgedAt: now, nudgeCount: row.p.nudgeCount + 1 })
			.where(
				and(
					eq(purchase.id, row.p.id),
					eq(purchase.state, 'pending_approval'),
					eq(purchase.nudgeCount, row.p.nudgeCount)
				)
			)
			.returning({ id: purchase.id });
		if (claimed.length === 0) continue;

		const approvers = await db
			.select({ memberId: purchaseApprover.memberId, userId: workspaceMember.userId })
			.from(purchaseApprover)
			.innerJoin(workspaceMember, eq(purchaseApprover.memberId, workspaceMember.id))
			.where(
				and(
					eq(purchaseApprover.purchaseId, row.p.id),
					eq(workspaceMember.status, 'active'),
					sql`${purchaseApprover.memberId} <> ${row.p.memberId}`
				)
			);
		const recipients: Recipient[] = approvers.map((a) => ({
			userId: a.userId,
			memberId: a.memberId
		}));
		if (recipients.length > 0) {
			const days = waitingDays(row.p.requestedAt, now);
			const amount = Money.of(
				row.p.finalAmountMinor ?? row.p.requestedAmountMinor,
				row.p.currency
			).format();
			await deps.notifier.notify(recipients, 'stale_nudge', {
				title: `Still waiting${days > 0 ? ` (${days} day${days === 1 ? '' : 's'})` : ''}: ${row.requesterName}`,
				body: `${row.p.itemName} · ${amount}`,
				path: `/w/${row.slug}/purchases/${row.p.id}`,
				tag: row.p.id
			});
		}
		nudged += 1;
	}
	return nudged;
}
