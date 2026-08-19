import type { WorkspaceContext } from '$lib/ports/context';
import type { LoadEvent } from '$lib/ports/handlers';
import { and, eq } from 'drizzle-orm';
import { toDiscretionMode } from '$lib/domain/visibility/discretion';
import { purchase } from '$lib/db/schema';
import { listLedger } from '$lib/repo/ledger';
import { listPurchases } from '$lib/repo/purchases';
import { safeToSpend, forecastMonths } from '$lib/repo/forecast';
import { toLedgerView } from '$lib/ledger-view';
import { listCategories, listMembers } from '$lib/repo/workspaces';
import { ledgerOptsFromUrl } from '$lib/ledger-query';

const LIMIT = 200;

export async function load(ctx: WorkspaceContext, { url, params }: LoadEvent) {
	// Also depend on the workspace param so a switch always re-runs this load,
	// independent of how finely SvelteKit tracks url/params. See +layout.server.ts.
	void params.workspace;
	const now = ctx.deps.clock.now();
	const db = ctx.db;
	const ws = ctx.workspace;
	// Filters are a URL concern, not client state: they change what the server
	// pages over, and they make the view shareable and restorable.
	const opts = ledgerOptsFromUrl(url.searchParams, ws.timezone);
	const scope = { workspaceId: ws.id, viewerId: ctx.member.id };

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
	const [feed, categories, members, awaitingIds, sleepingIds, forecast, runway] = await Promise.all(
		[
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
						eq(purchase.memberId, ctx.member.id)
					)
				),
			// "Sleep on it": everything paused in the workspace, its own to-do.
			db
				.select({ id: purchase.id })
				.from(purchase)
				.where(and(eq(purchase.workspaceId, ws.id), eq(purchase.state, 'held'))),
			// Harmony's number: Safe to Spend this month, seal-scoped to the viewer.
			safeToSpend(db, { workspaceId: ws.id, viewerId: ctx.member.id, timezone: ws.timezone }, now),
			// The months after this one — a quiet forward look under the headline.
			forecastMonths(
				db,
				{ workspaceId: ws.id, viewerId: ctx.member.id, timezone: ws.timezone },
				now,
				3
			)
		]
	);

	const viewCtx = {
		now,
		staleAfterHours: ws.staleAfterHours,
		viewerId: ctx.member.id
	};

	const awaitingConfirmation = (
		await listPurchases(db, scope, now, { ids: awaitingIds.map((r) => r.id) })
	)
		.map((pp) => toLedgerView({ kind: 'purchase' as const, ...pp }, viewCtx))
		// Oldest first: clear the backlog in the order it built up.
		.sort((a, b) => a.at.localeCompare(b.at));

	const sleeping = (await listPurchases(db, scope, now, { ids: sleepingIds.map((r) => r.id) }))
		.map((pp) => toLedgerView({ kind: 'purchase' as const, ...pp }, viewCtx))
		// Soonest to wake first — the ones nearest a decision lead.
		.sort((a, b) => {
			const ax = a.kind === 'purchase' ? (a.heldUntil ?? '') : '';
			const bx = b.kind === 'purchase' ? (b.heldUntil ?? '') : '';
			return ax.localeCompare(bx);
		});
	/*
	 * What to call the geographic filter in the chip.
	 *
	 * Read off the rows the filter actually returned rather than passed down the
	 * link, so the chip can never name a place the list isn't showing. When the
	 * window covers several named places — a zoomed-out bubble — it says so
	 * instead of picking one and implying the rest aren't there.
	 */
	let placeLabel: string | null = null;
	if (opts.bbox) {
		const names = [
			...new Set(
				feed.entries
					.map((e) => (e.kind === 'purchase' ? (e.merchantName ?? e.placeLabel) : null))
					.filter((n): n is string => !!n)
			)
		];
		placeLabel =
			names.length === 1 ? names[0] : names.length > 1 ? `${names.length} places` : 'On the map';
	}

	return {
		entries: feed.entries.map((e) => toLedgerView(e, viewCtx)),
		placeLabel,
		categories,
		members: members
			.filter((m) => m.member.status === 'active')
			.map((m) => ({ id: m.member.id, name: m.user.displayName })),
		hasMore: feed.hasMore,
		// The true number of rows matching the current filters, not the number
		// loaded — the header reports this so the count doesn't grow as you page.
		total: feed.total,
		includeMovements: opts.includeMovements ?? ctx.member.includeLedgerMovements,
		awaitingConfirmation,
		sleeping,
		forecast,
		runway,
		// How much of the headline this member wants legible on arrival. Server-side
		// so a masked number never renders before the client can hide it.
		safeToSpendDisplay: toDiscretionMode(ctx.member.safeToSpendDisplay),
		// Whether the breakdown projects the months after this one. A reading
		// preference, set in Harmony settings alongside the display mode.
		showRunwayMonths: ctx.member.showRunwayMonths,
		currency: ws.currency
	};
}
