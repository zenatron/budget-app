import { getDb } from '$lib/server/db';
import { listLedger } from '$lib/server/repo/ledger';
import { toLedgerView } from '$lib/server/ledger-view';
import { listCategories } from '$lib/server/repo/workspaces';
import { systemClock } from '$lib/infra/time/system-clock';
import type { PageServerLoad } from './$types';

const LIMIT = 200;

export const load: PageServerLoad = async ({ locals, url }) => {
	const now = systemClock.now();
	const db = getDb();
	// Bucket movements are a URL concern, not client state: it changes what the
	// server pages over, and it makes the view shareable and restorable.
	const includeMovements = url.searchParams.get('movements') === '1';
	const search = url.searchParams.get('q') ?? undefined;
	const categoryId = url.searchParams.get('category') ?? undefined;
	const scope = { workspaceId: locals.workspace!.id, viewerId: locals.member!.id };

	const [feed, categories] = await Promise.all([
		listLedger(db, scope, now, { limit: LIMIT, includeMovements, search, categoryId }),
		listCategories(db, locals.workspace!.id)
	]);

	const ctx = {
		now,
		staleAfterHours: locals.workspace!.staleAfterHours,
		viewerId: locals.member!.id
	};
	return {
		entries: feed.entries.map((e) => toLedgerView(e, ctx)),
		categories,
		hasMore: feed.hasMore,
		includeMovements
	};
};
