import { eq } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { bucket, workspace } from '$lib/server/db/schema';
import type { Clock } from '$lib/ports/clock';
import type { IdGenerator } from '$lib/ports/id-generator';
import { calDateInZone, zonedTimeToUtc } from '$lib/domain/time/zoned';
import { addTransaction, hasAccrualForMonth } from '$lib/server/repo/buckets';

interface Deps {
	clock: Clock;
	ids: IdGenerator;
}

/**
 * Compute the next occurrence of a day-of-month. If today is before or on the
 * day, returns this month's occurrence. If today is past the day, returns next
 * month's occurrence. Clamped to 28 to handle February safely.
 */
export function nextAccrualDate(
	today: { y: number; m: number; d: number },
	dayOfMonth: number,
	timezone: string
): Date {
	const clamped = Math.min(dayOfMonth, 28);
	const nextM = today.d > clamped ? today.m + 1 : today.m;
	const nextY = nextM > 12 ? today.y + 1 : today.y;
	const month = nextM > 12 ? nextM - 12 : nextM;
	return zonedTimeToUtc({ y: nextY, m: month, d: clamped }, 9, 0, timezone);
}

export async function materializeBucketAccruals(db: Db, deps: Deps): Promise<number> {
	const now = deps.clock.now();

	const activeBuckets = await db
		.select({
			b: bucket,
			tz: workspace.timezone
		})
		.from(bucket)
		.innerJoin(workspace, eq(bucket.workspaceId, workspace.id))
		.where(eq(bucket.status, 'active'));

	let accrued = 0;
	for (const { b, tz } of activeBuckets) {
		const today = calDateInZone(now, tz);

		// Guard: defer until the scheduled date, if one is set in the future.
		if (b.nextAccrualAt && b.nextAccrualAt.getTime() > now.getTime()) continue;

		// Guard: today hasn't reached the day-of-month yet.
		if (today.d < b.dayOfMonth) continue;

		// Guard: this month already has an accrual.
		const already = await db.transaction(async (tx) => {
			const locked = await tx
				.select({ id: bucket.id, status: bucket.status })
				.from(bucket)
				.where(eq(bucket.id, b.id))
				.for('update')
				.limit(1);
			if (!locked[0] || locked[0].status !== 'active') return true;

			if (await hasAccrualForMonth(tx, b.id, today.y, today.m)) return true;

			// Create the accrual and advance the pointer to next month.
			await addTransaction(tx, deps, {
				bucketId: b.id,
				amountMinor: b.monthlyAmountMinor,
				currency: b.currency,
				type: 'accrual'
			});

			const next = nextAccrualDate(today, b.dayOfMonth, tz);
			await tx.update(bucket).set({ nextAccrualAt: next }).where(eq(bucket.id, b.id));

			return false;
		});

		if (!already) accrued += 1;
	}

	return accrued;
}
