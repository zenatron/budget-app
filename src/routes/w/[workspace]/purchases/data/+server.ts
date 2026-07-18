import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { listPurchases } from '$lib/server/repo/purchases';
import { isStale, waitingDays } from '$lib/domain/approval/staleness';
import { systemClock } from '$lib/infra/time/system-clock';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	const now = systemClock.now();
	const search = url.searchParams.get('q') ?? undefined;
	const categoryId = url.searchParams.get('category') ?? undefined;
	const offset = parseInt(url.searchParams.get('offset') ?? '0') || 0;
	const db = getDb();
	const items = await listPurchases(
		db,
		{ workspaceId: locals.workspace!.id, viewerId: locals.member!.id },
		now,
		{ search, categoryId, limit: 21, offset }
	);
	const hasMore = items.length > 20;
	if (hasMore) items.pop();
	const staleAfterHours = locals.workspace!.staleAfterHours;
	return json({
		purchases: items.map((i) => ({
			...i,
			createdAt: i.createdAt.toISOString(),
			stale:
				i.state === 'pending_approval' &&
				i.requestedAt !== null &&
				isStale(i.requestedAt, staleAfterHours, now),
			waitingDays:
				i.state === 'pending_approval' && i.requestedAt !== null
					? waitingDays(i.requestedAt, now)
					: 0,
			mine: i.requesterMemberId === locals.member!.id
		})),
		hasMore
	});
};
