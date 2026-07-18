import { getDb } from '$lib/server/db';
import { listPurchases } from '$lib/server/repo/purchases';
import { isStale, waitingDays } from '$lib/domain/approval/staleness';
import { systemClock } from '$lib/infra/time/system-clock';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const now = systemClock.now();
	const items = await listPurchases(
		getDb(),
		{ workspaceId: locals.workspace!.id, viewerId: locals.member!.id },
		now
	);
	const staleAfterHours = locals.workspace!.staleAfterHours;
	return {
		purchases: items.map((i) => ({
			...i,
			stale:
				i.state === 'pending_approval' &&
				i.requestedAt !== null &&
				isStale(i.requestedAt, staleAfterHours, now),
			waitingDays:
				i.state === 'pending_approval' && i.requestedAt !== null
					? waitingDays(i.requestedAt, now)
					: 0,
			mine: i.requesterMemberId === locals.member!.id
		}))
	};
};
