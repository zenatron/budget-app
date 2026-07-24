import { and, eq, isNull, lte } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { purchase, user, workspace, workspaceMember } from '$lib/server/db/schema';
import { Money } from '$lib/domain/money/money';
import type { Clock } from '$lib/ports/clock';
import type { IdGenerator } from '$lib/ports/id-generator';
import type { Notifier } from '$lib/ports/notifier';

/**
 * Sweep: a held purchase whose pause has lifted is "ready to decide". This
 * doesn't change its state — the human chooses (buy it / wait more / let
 * it go) — it only rings the requester once, then marks it notified so a request
 * that sits ready for a while doesn't nag every interval.
 */
export async function releaseDueHolds(
	db: Db,
	deps: { clock: Clock; ids: IdGenerator; notifier: Notifier }
): Promise<number> {
	const now = deps.clock.now();
	const due = await db.transaction(async (tx) => {
		const rows = await tx
			.select()
			.from(purchase)
			.where(
				and(
					eq(purchase.state, 'held'),
					lte(purchase.heldUntil, now),
					isNull(purchase.heldNotifiedAt)
				)
			)
			.for('update');
		for (const row of rows) {
			await tx.update(purchase).set({ heldNotifiedAt: now }).where(eq(purchase.id, row.id));
		}
		return rows;
	});

	// Notify after commit only.
	for (const row of due) {
		try {
			const [dest] = await db
				.select({ userId: workspaceMember.userId, slug: workspace.slug })
				.from(workspaceMember)
				.innerJoin(workspace, eq(workspaceMember.workspaceId, workspace.id))
				.innerJoin(user, eq(workspaceMember.userId, user.id))
				.where(eq(workspaceMember.id, row.memberId))
				.limit(1);
			if (!dest) continue;
			await deps.notifier.notify([{ userId: dest.userId, memberId: row.memberId }], 'stale_nudge', {
				title: 'Ready to decide',
				body: `${row.itemName} · ${Money.of(row.requestedAmountMinor, row.currency).format()} — still want it?`,
				path: `/w/${dest.slug}/purchases/${row.id}`,
				tag: row.id
			});
		} catch (e) {
			console.log(
				JSON.stringify({
					level: 'warn',
					msg: 'notify: hold ready failed',
					err: (e as Error).message
				})
			);
		}
	}
	return due.length;
}
