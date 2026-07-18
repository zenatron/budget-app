import { getDb } from '$lib/server/db';
import { listPurchases } from '$lib/server/repo/purchases';
import { listCategories } from '$lib/server/repo/workspaces';
import { isStale, waitingDays } from '$lib/domain/approval/staleness';
import { systemClock } from '$lib/infra/time/system-clock';
import type { PageServerLoad } from './$types';

const LIMIT = 200;

export const load: PageServerLoad = async ({ locals }) => {
	const now = systemClock.now();
	const db = getDb();
	const [items, categories] = await Promise.all([
		listPurchases(db, { workspaceId: locals.workspace!.id, viewerId: locals.member!.id }, now, {
			limit: LIMIT + 1
		}),
		listCategories(db, locals.workspace!.id)
	]);
	const hasMore = items.length > LIMIT;
	if (hasMore) items.pop();
	const staleAfterHours = locals.workspace!.staleAfterHours;
	return {
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
		categories,
		hasMore
	};
};
