import { getDb } from '$lib/server/db';
import { listLedger } from '$lib/server/repo/ledger';
import { toLedgerView } from '$lib/server/ledger-view';
import { listCategories, listMembers } from '$lib/server/repo/workspaces';
import { ledgerOptsFromUrl } from '$lib/server/ledger-query';
import { systemClock } from '$lib/infra/time/system-clock';
import type { PageServerLoad } from './$types';

const LIMIT = 200;

export const load: PageServerLoad = async ({ locals, url }) => {
	const now = systemClock.now();
	const db = getDb();
	const ws = locals.workspace!;
	// Filters are a URL concern, not client state: they change what the server
	// pages over, and they make the view shareable and restorable.
	const opts = ledgerOptsFromUrl(url.searchParams, ws.timezone);
	const scope = { workspaceId: ws.id, viewerId: locals.member!.id };

	const [feed, categories, members] = await Promise.all([
		listLedger(db, scope, now, { ...opts, limit: LIMIT }),
		listCategories(db, ws.id),
		listMembers(db, ws.id)
	]);

	const ctx = {
		now,
		staleAfterHours: ws.staleAfterHours,
		viewerId: locals.member!.id
	};
	return {
		entries: feed.entries.map((e) => toLedgerView(e, ctx)),
		categories,
		members: members
			.filter((m) => m.member.status === 'active')
			.map((m) => ({ id: m.member.id, name: m.user.displayName })),
		hasMore: feed.hasMore,
		includeMovements: opts.includeMovements ?? false
	};
};
