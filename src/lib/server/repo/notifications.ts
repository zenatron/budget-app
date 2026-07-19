import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { notificationPref, ntfyTarget, pushSubscription } from '$lib/server/db/schema';
import type { Clock } from '$lib/ports/clock';
import type { IdGenerator } from '$lib/ports/id-generator';

/** Subscriptions expire and churn; upsert by endpoint on every launch. */
export async function upsertPushSubscription(
	db: Db,
	deps: { clock: Clock; ids: IdGenerator },
	sub: {
		userId: string;
		endpoint: string;
		p256dh: string;
		auth: string;
		userAgent: string | null;
	}
): Promise<void> {
	const now = deps.clock.now();
	await db
		.insert(pushSubscription)
		.values({
			id: deps.ids.newId(),
			userId: sub.userId,
			endpoint: sub.endpoint,
			p256dh: sub.p256dh,
			auth: sub.auth,
			userAgent: sub.userAgent,
			platform: null,
			createdAt: now,
			lastSeenAt: now,
			failureCount: 0
		})
		.onConflictDoUpdate({
			target: pushSubscription.endpoint,
			set: {
				userId: sub.userId,
				p256dh: sub.p256dh,
				auth: sub.auth,
				userAgent: sub.userAgent,
				lastSeenAt: now,
				failureCount: 0
			}
		});
}

export async function deletePushSubscription(db: Db, userId: string, endpoint: string) {
	await db
		.delete(pushSubscription)
		.where(and(eq(pushSubscription.userId, userId), eq(pushSubscription.endpoint, endpoint)));
}

export async function listPushSubscriptions(db: Db, userIds: string[]) {
	if (userIds.length === 0) return [];
	return db.select().from(pushSubscription).where(inArray(pushSubscription.userId, userIds));
}

/** Gone (404/410) → delete. Other failures count up; prune at 10 strikes. */
export async function recordPushFailure(db: Db, endpoint: string, gone: boolean) {
	if (gone) {
		await db.delete(pushSubscription).where(eq(pushSubscription.endpoint, endpoint));
		return;
	}
	const rows = await db
		.update(pushSubscription)
		.set({ failureCount: sql`${pushSubscription.failureCount} + 1` })
		.where(eq(pushSubscription.endpoint, endpoint))
		.returning({ failureCount: pushSubscription.failureCount });
	if (rows[0] && rows[0].failureCount >= 10) {
		await db.delete(pushSubscription).where(eq(pushSubscription.endpoint, endpoint));
	}
}

/** One ntfy target per user; setting a new topic replaces the old one. */
export async function setNtfyTarget(
	db: Db,
	deps: { clock: Clock; ids: IdGenerator },
	cmd: { userId: string; topic: string; serverUrl: string }
) {
	// Delete + insert as one unit: a failure between them would leave the user
	// with no target at all rather than the old one.
	await db.transaction(async (tx) => {
		await tx.delete(ntfyTarget).where(eq(ntfyTarget.userId, cmd.userId));
		await tx.insert(ntfyTarget).values({
			id: deps.ids.newId(),
			userId: cmd.userId,
			topic: cmd.topic,
			serverUrl: cmd.serverUrl,
			createdAt: deps.clock.now()
		});
	});
}

export async function deleteNtfyTarget(db: Db, userId: string) {
	await db.delete(ntfyTarget).where(eq(ntfyTarget.userId, userId));
}

export async function listNtfyTargets(db: Db, userIds: string[]) {
	if (userIds.length === 0) return [];
	return db.select().from(ntfyTarget).where(inArray(ntfyTarget.userId, userIds));
}

export async function getNtfyTarget(db: Db, userId: string) {
	const rows = await db.select().from(ntfyTarget).where(eq(ntfyTarget.userId, userId)).limit(1);
	return rows[0] ?? null;
}

/**
 * Preference rows exist only when a member turned something off — absence
 * means enabled. Returns the set of "disabled" (memberId, eventType, channel).
 */
export async function listDisabledPrefs(db: Db, memberIds: string[]) {
	if (memberIds.length === 0) return [];
	return db
		.select()
		.from(notificationPref)
		.where(
			and(
				inArray(notificationPref.workspaceMemberId, memberIds),
				eq(notificationPref.enabled, false)
			)
		);
}

export async function setPref(
	db: Db,
	cmd: { memberId: string; eventType: string; channel: string; enabled: boolean }
) {
	await db
		.insert(notificationPref)
		.values({
			workspaceMemberId: cmd.memberId,
			eventType: cmd.eventType,
			channel: cmd.channel,
			enabled: cmd.enabled
		})
		.onConflictDoUpdate({
			target: [
				notificationPref.workspaceMemberId,
				notificationPref.eventType,
				notificationPref.channel
			],
			set: { enabled: cmd.enabled }
		});
}
