import { and, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { purchase } from '$lib/server/db/schema';
import { listLedger } from '$lib/server/repo/ledger';
import { listPurchases } from '$lib/server/repo/purchases';
import { toLedgerView } from '$lib/server/ledger-view';
import { listCategories, listMembers } from '$lib/server/repo/workspaces';
import { ledgerOptsFromUrl } from '$lib/server/ledger-query';
import { systemClock } from '$lib/infra/time/system-clock';
import type { PageServerLoad } from './$types';

const LIMIT = 200;

export const load: PageServerLoad = async ({ locals, url, params }) => {
	// Also depend on the workspace param so a switch always re-runs this load,
	// independent of how finely SvelteKit tracks url/params. See +layout.server.ts.
	void params.workspace;
	const now = systemClock.now();
	const db = getDb();
	const ws = locals.workspace!;
	// Filters are a URL concern, not client state: they change what the server
	// pages over, and they make the view shareable and restorable.
	const opts = ledgerOptsFromUrl(url.searchParams, ws.timezone);
	const scope = { workspaceId: ws.id, viewerId: locals.member!.id };

	/*
	 * Your own approved-but-unconfirmed purchases — the "confirm what you paid"
	 * to-do. An approved purchase is one that's been greenlit but has no final
	 * amount recorded yet (a recurring charge with "same amount" off, or a normal
	 * request after approval). Only the requester can complete it, so it's scoped
	 * to memberId = you.
	 *
	 * Fetched on its own rather than filtered out of the paged feed: these can be
	 * months old (a backfilled bill), so they'd otherwise sort into a later page
	 * and be exactly the thing this section exists to stop getting lost.
	 */
	const [feed, categories, members, awaitingIds, sleepingIds] = await Promise.all([
		listLedger(db, scope, now, { ...opts, limit: LIMIT }),
		listCategories(db, ws.id),
		listMembers(db, ws.id),
		db
			.select({ id: purchase.id })
			.from(purchase)
			.where(
				and(
					eq(purchase.workspaceId, ws.id),
					eq(purchase.state, 'approved'),
					eq(purchase.memberId, locals.member!.id)
				)
			),
		// "Sleep on it": everything paused in the workspace, its own to-do.
		db
			.select({ id: purchase.id })
			.from(purchase)
			.where(and(eq(purchase.workspaceId, ws.id), eq(purchase.state, 'held')))
	]);

	const ctx = {
		now,
		staleAfterHours: ws.staleAfterHours,
		viewerId: locals.member!.id
	};

	const awaitingConfirmation = (
		await listPurchases(db, scope, now, { ids: awaitingIds.map((r) => r.id) })
	)
		.map((pp) => toLedgerView({ kind: 'purchase' as const, ...pp }, ctx))
		// Oldest first: clear the backlog in the order it built up.
		.sort((a, b) => a.at.localeCompare(b.at));

	const sleeping = (await listPurchases(db, scope, now, { ids: sleepingIds.map((r) => r.id) }))
		.map((pp) => toLedgerView({ kind: 'purchase' as const, ...pp }, ctx))
		// Soonest to wake first — the ones nearest a decision lead.
		.sort((a, b) => {
			const ax = a.kind === 'purchase' ? (a.heldUntil ?? '') : '';
			const bx = b.kind === 'purchase' ? (b.heldUntil ?? '') : '';
			return ax.localeCompare(bx);
		});
	return {
		entries: feed.entries.map((e) => toLedgerView(e, ctx)),
		categories,
		members: members
			.filter((m) => m.member.status === 'active')
			.map((m) => ({ id: m.member.id, name: m.user.displayName })),
		hasMore: feed.hasMore,
		includeMovements: opts.includeMovements ?? false,
		awaitingConfirmation,
		sleeping
	};
};
