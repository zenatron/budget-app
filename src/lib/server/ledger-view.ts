import { isStale, waitingDays } from '$lib/domain/approval/staleness';
import type { LedgerEntry } from '$lib/server/repo/ledger';

/**
 * Shapes a ledger entry for the client. Shared by the page load and the
 * pagination endpoint, which have to agree exactly — the client appends one
 * to the other.
 */
export function toLedgerView(
	e: LedgerEntry,
	ctx: { now: Date; staleAfterHours: number; viewerId: string }
) {
	if (e.kind === 'movement') {
		return {
			kind: 'movement' as const,
			id: e.id,
			at: e.at.toISOString(),
			bucketId: e.bucketId,
			bucketName: e.bucketName,
			bucketColor: e.bucketColor,
			type: e.type,
			amountMinor: e.amountMinor,
			currency: e.currency,
			note: e.note
		};
	}
	return {
		...e,
		kind: 'purchase' as const,
		/*
		 * When the row happened, by the same rule the ledger sorts and filters on
		 * — `purchaseAt` in repo/ledger.ts. The row used to be labelled with
		 * createdAt while being ordered by this, so a backfilled charge (created
		 * today, completed in March) sorted under March and read "Jul 19". Filter
		 * to March and you'd get a row stamped outside the range you asked for.
		 */
		at: (e.completedAt ?? e.requestedAt ?? e.createdAt).toISOString(),
		createdAt: e.createdAt.toISOString(),
		stale:
			e.state === 'pending_approval' &&
			e.requestedAt !== null &&
			isStale(e.requestedAt, ctx.staleAfterHours, ctx.now),
		waitingDays:
			e.state === 'pending_approval' && e.requestedAt !== null
				? waitingDays(e.requestedAt, ctx.now)
				: 0,
		mine: e.requesterMemberId === ctx.viewerId
	};
}

export type LedgerView = ReturnType<typeof toLedgerView>;
