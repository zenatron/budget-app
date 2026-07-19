/**
 * One reading of the ledger's query string.
 *
 * The page load and the "Show more" endpoint have to agree exactly — the second
 * page of a filtered list is only coherent if it was filtered the same way as
 * the first. They parsed the URL separately before, and the endpoint quietly
 * knew about fewer filters than the page did.
 */

import { periodBoundsUtc } from '$lib/domain/analytics/period';
import { addDays, type CalDate } from '$lib/domain/recurrence/rrule';
import { NO_CATEGORY } from '$lib/ledger-filters';
import type { LedgerBasis, LedgerOpts } from '$lib/server/repo/ledger';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-06-01" -> CalDate, or null if it isn't one. */
function parseDate(raw: string | null): CalDate | null {
	if (!raw || !DATE_RE.test(raw)) return null;
	const [y, m, d] = raw.split('-').map(Number);
	if (m < 1 || m > 12 || d < 1 || d > 31) return null;
	return { y, m, d };
}

export function ledgerOptsFromUrl(params: URLSearchParams, timezone: string): LedgerOpts {
	const rawCategory = params.get('category') ?? '';
	const uncategorized = rawCategory === NO_CATEGORY;

	/*
	 * Calendar dates become instants here, in the workspace timezone — the repo
	 * takes instants only, and this is the layer that knows the zone. `to` is
	 * inclusive in the URL because that is how a person reads "Jun 1 – Jun 30",
	 * and exclusive in the query because a half-open bound is the only one that
	 * doesn't double-count midnight.
	 */
	const fromDate = parseDate(params.get('from'));
	const toDate = parseDate(params.get('to'));
	const bounds =
		fromDate || toDate
			? periodBoundsUtc(
					{
						from: fromDate ?? { y: 1970, m: 1, d: 1 },
						toExclusive: toDate ? addDays(toDate, 1) : { y: 9999, m: 1, d: 1 }
					},
					timezone
				)
			: null;

	// Only ever 'spend' when asked for explicitly, which is what the analytics
	// drill-through links do. A hand-picked range means "everything that happened
	// in it", so it keeps the default.
	const basis: LedgerBasis = params.get('basis') === 'spend' ? 'spend' : 'activity';

	return {
		search: params.get('q') || undefined,
		categoryId: uncategorized ? undefined : rawCategory || undefined,
		uncategorized,
		memberId: params.get('member') || undefined,
		from: bounds?.from,
		to: bounds?.to,
		basis,
		includeMovements: params.get('movements') === '1'
	};
}
