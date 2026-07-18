import { eq } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { bucket, workspace } from '$lib/server/db/schema';
import type { Clock } from '$lib/ports/clock';
import type { IdGenerator } from '$lib/ports/id-generator';
import { calDateInZone } from '$lib/domain/time/zoned';
import { addTransaction, hasAccrualForMonth } from '$lib/server/repo/buckets';

interface Deps {
	clock: Clock;
	ids: IdGenerator;
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

		if (today.d < b.dayOfMonth) continue;

		const alreadyAccrued = await hasAccrualForMonth(db, b.id, today.y, today.m);
		if (alreadyAccrued) continue;

		await addTransaction(db, deps, {
			bucketId: b.id,
			amountMinor: b.monthlyAmountMinor,
			currency: b.currency,
			type: 'accrual'
		});
		accrued += 1;
	}

	return accrued;
}
