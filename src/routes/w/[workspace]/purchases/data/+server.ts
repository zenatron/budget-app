import { getDb } from '$lib/server/db';
import { listLedger } from '$lib/server/repo/ledger';
import { toLedgerView } from '$lib/server/ledger-view';
import { ledgerOptsFromUrl } from '$lib/server/ledger-query';
import { systemClock } from '$lib/infra/time/system-clock';
import type { RequestHandler } from './$types';

function jsonSafe(data: unknown) {
	return new Response(
		JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
		{ headers: { 'content-type': 'application/json' } }
	);
}

export const GET: RequestHandler = async ({ locals, url }) => {
	const now = systemClock.now();
	const db = getDb();
	const scope = { workspaceId: locals.workspace!.id, viewerId: locals.member!.id };
	const feed = await listLedger(db, scope, now, {
		...ledgerOptsFromUrl(url.searchParams, locals.workspace!.timezone),
		limit: 20,
		offset: parseInt(url.searchParams.get('offset') ?? '0') || 0
	});

	const ctx = {
		now,
		staleAfterHours: locals.workspace!.staleAfterHours,
		viewerId: locals.member!.id
	};
	return jsonSafe({
		entries: feed.entries.map((e) => toLedgerView(e, ctx)),
		hasMore: feed.hasMore
	});
};
