import { and, lte, sql } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { purchase } from '$lib/server/db/schema';
import { appendEvent, mapPurchaseRow } from '$lib/server/repo/purchases';
import { announcePurchaseChange } from '$lib/application/notify-dispatch';
import { unsealEvent } from '$lib/application/purchases';
import type { Clock } from '$lib/ports/clock';
import type { IdGenerator } from '$lib/ports/id-generator';
import type { Notifier } from '$lib/ports/notifier';

/**
 * Sweep: open every seal whose time has come. One-way — clears the concealed
 * list (keeping sealed_until as history) and audit-logs the reveal. Runs at
 * boot and on an interval; concurrent runs are safe (FOR UPDATE + the
 * predicate only matches rows still sealed).
 */
export async function unsealDuePurchases(
	db: Db,
	deps: { clock: Clock; ids: IdGenerator; notifier: Notifier }
): Promise<number> {
	const now = deps.clock.now();
	const opened = await db.transaction(async (tx) => {
		const due = await tx
			.select()
			.from(purchase)
			.where(
				and(lte(purchase.sealedUntil, now), sql`cardinality(${purchase.sealedFromMemberIds}) > 0`)
			)
			.for('update');
		for (const row of due) {
			await tx
				.update(purchase)
				.set({ sealedFromMemberIds: [], updatedAt: now })
				.where(sql`${purchase.id} = ${row.id}`);
			const p = mapPurchaseRow({ ...row, sealedFromMemberIds: [] }, []);
			await appendEvent(tx, deps.ids, row.id, unsealEvent(p, null, row.sealedFromMemberIds, now));
		}
		return due;
	});
	// Notify after commit only.
	for (const row of opened) {
		const p = mapPurchaseRow({ ...row, sealedFromMemberIds: [] }, []);
		await announcePurchaseChange(
			db,
			deps.notifier,
			p,
			unsealEvent(p, null, row.sealedFromMemberIds, now)
		);
	}
	return opened.length;
}
