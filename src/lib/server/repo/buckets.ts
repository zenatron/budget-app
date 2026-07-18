import { and, eq, ne, sql } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { bucket, bucketTransaction, user, workspaceMember } from '$lib/server/db/schema';
import type { Clock } from '$lib/ports/clock';
import type { IdGenerator } from '$lib/ports/id-generator';

export type BucketRow = typeof bucket.$inferSelect;
export type BucketTransactionRow = typeof bucketTransaction.$inferSelect;

export interface CreateBucketCmd {
	workspaceId: string;
	memberId: string;
	name: string;
	monthlyAmountMinor: bigint;
	currency: string;
	dayOfMonth: number;
	goalCapMinor?: bigint | null;
	color?: string | null;
	icon?: string | null;
}

export interface BucketListItem {
	bucket: BucketRow;
	memberName: string;
	balanceMinor: bigint;
}

export interface AddTransactionCmd {
	bucketId: string;
	amountMinor: bigint;
	currency: string;
	type: BucketTransactionRow['type'];
	note?: string | null;
}

export async function createBucket(
	db: Db,
	deps: { clock: Clock; ids: IdGenerator },
	cmd: CreateBucketCmd
): Promise<BucketRow> {
	const id = deps.ids.newId();
	const now = deps.clock.now();
	await db.insert(bucket).values({
		id,
		workspaceId: cmd.workspaceId,
		memberId: cmd.memberId,
		name: cmd.name,
		monthlyAmountMinor: cmd.monthlyAmountMinor,
		currency: cmd.currency,
		dayOfMonth: cmd.dayOfMonth,
		goalCapMinor: cmd.goalCapMinor ?? null,
		color: cmd.color ?? null,
		icon: cmd.icon ?? null,
		status: 'active',
		createdAt: now
	});
	const [row] = await db.select().from(bucket).where(eq(bucket.id, id)).limit(1);
	return row!;
}

export async function listBuckets(db: Db, workspaceId: string): Promise<BucketListItem[]> {
	const rows = await db
		.select({
			bucket,
			memberName: user.displayName,
			balanceMinor: sql<string>`coalesce(sum(${bucketTransaction.amountMinor}), 0)`
		})
		.from(bucket)
		.innerJoin(workspaceMember, eq(bucket.memberId, workspaceMember.id))
		.innerJoin(user, eq(workspaceMember.userId, user.id))
		.leftJoin(bucketTransaction, eq(bucket.id, bucketTransaction.bucketId))
		.where(and(eq(bucket.workspaceId, workspaceId), ne(bucket.status, 'archived')))
		.groupBy(bucket.id, workspaceMember.id, user.id)
		.orderBy(bucket.createdAt);

	return rows.map((r) => ({
		bucket: r.bucket,
		memberName: r.memberName,
		balanceMinor: BigInt(r.balanceMinor)
	}));
}

export async function loadBucket(
	db: Db,
	workspaceId: string,
	bucketId: string
): Promise<BucketRow | null> {
	const rows = await db
		.select()
		.from(bucket)
		.where(and(eq(bucket.id, bucketId), eq(bucket.workspaceId, workspaceId)))
		.limit(1);
	return rows[0] ?? null;
}

export interface UpdateBucketCmd {
	name?: string;
	monthlyAmountMinor?: bigint;
	dayOfMonth?: number;
	goalCapMinor?: bigint | null;
	color?: string | null;
	icon?: string | null;
}

async function loadOwnBucket(
	db: Db,
	scope: { workspaceId: string; memberId: string },
	bucketId: string
) {
	const b = await loadBucket(db, scope.workspaceId, bucketId);
	if (!b) return null;
	if (b.memberId !== scope.memberId) return null;
	return b;
}

export async function updateBucket(
	db: Db,
	scope: { workspaceId: string; memberId: string },
	bucketId: string,
	changes: UpdateBucketCmd
): Promise<BucketRow | null> {
	const b = await loadOwnBucket(db, scope, bucketId);
	if (!b) return null;

	if (Object.keys(changes).length === 0) return b;

	const updates: Record<string, unknown> = {};
	if (changes.name !== undefined) updates.name = changes.name;
	if (changes.monthlyAmountMinor !== undefined)
		updates.monthlyAmountMinor = changes.monthlyAmountMinor;
	if (changes.dayOfMonth !== undefined) updates.dayOfMonth = changes.dayOfMonth;
	if (changes.goalCapMinor !== undefined) updates.goalCapMinor = changes.goalCapMinor;
	if (changes.color !== undefined) updates.color = changes.color;
	if (changes.icon !== undefined) updates.icon = changes.icon;

	if (Object.keys(updates).length === 0) return b;

	await db.update(bucket).set(updates).where(eq(bucket.id, bucketId));
	const [row] = await db.select().from(bucket).where(eq(bucket.id, bucketId)).limit(1);
	return row!;
}

export async function pauseBucket(
	db: Db,
	scope: { workspaceId: string; memberId: string },
	bucketId: string
) {
	const b = await loadOwnBucket(db, scope, bucketId);
	if (!b) throw new Error('Bucket not found');
	if (b.status !== 'active') throw new Error('Only active buckets can be paused');
	await db.update(bucket).set({ status: 'paused' }).where(eq(bucket.id, bucketId));
}

export async function resumeBucket(
	db: Db,
	scope: { workspaceId: string; memberId: string },
	bucketId: string
) {
	const b = await loadOwnBucket(db, scope, bucketId);
	if (!b) throw new Error('Bucket not found');
	if (b.status !== 'paused') throw new Error('Only paused buckets can be resumed');
	await db.update(bucket).set({ status: 'active' }).where(eq(bucket.id, bucketId));
}

export async function archiveBucket(
	db: Db,
	scope: { workspaceId: string; memberId: string },
	bucketId: string
) {
	const b = await loadOwnBucket(db, scope, bucketId);
	if (!b) throw new Error('Bucket not found');
	if (b.status === 'archived') throw new Error('Bucket is already archived');
	await db.update(bucket).set({ status: 'archived' }).where(eq(bucket.id, bucketId));
}

export async function addTransaction(
	db: Db,
	deps: { clock: Clock; ids: IdGenerator },
	cmd: AddTransactionCmd
): Promise<BucketTransactionRow> {
	const id = deps.ids.newId();
	const now = deps.clock.now();
	await db.insert(bucketTransaction).values({
		id,
		bucketId: cmd.bucketId,
		amountMinor: cmd.amountMinor,
		currency: cmd.currency,
		type: cmd.type,
		note: cmd.note ?? null,
		createdAt: now
	});
	const [row] = await db
		.select()
		.from(bucketTransaction)
		.where(eq(bucketTransaction.id, id))
		.limit(1);
	return row!;
}

export async function hasAccrualForMonth(
	db: Db,
	bucketId: string,
	year: number,
	month: number
): Promise<boolean> {
	const rows = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(bucketTransaction)
		.where(
			and(
				eq(bucketTransaction.bucketId, bucketId),
				eq(bucketTransaction.type, 'accrual'),
				sql`extract(year from ${bucketTransaction.createdAt}) = ${year} and extract(month from ${bucketTransaction.createdAt}) = ${month}`
			)
		);
	return (rows[0]?.count ?? 0) > 0;
}

export async function totalSaved(db: Db, workspaceId: string): Promise<bigint> {
	const rows = await db
		.select({
			total: sql<string>`coalesce(sum(${bucketTransaction.amountMinor}), 0)`
		})
		.from(bucketTransaction)
		.innerJoin(bucket, eq(bucketTransaction.bucketId, bucket.id))
		.where(eq(bucket.workspaceId, workspaceId));
	return BigInt(rows[0]?.total ?? '0');
}
