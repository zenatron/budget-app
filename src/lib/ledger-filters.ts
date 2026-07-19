/**
 * The ledger's filter vocabulary, shared by the page that reads it and the
 * analytics page that writes it into drill-through links. Both sides import
 * these so a rename can't silently break the hand-off.
 */

/**
 * `category=none` means "has no category" — the rows analytics shows as
 * "Other". A plain id can't express absence, and an empty param already means
 * "no category filter at all".
 */
export const NO_CATEGORY = 'none';

export interface LedgerLinkParams {
	/** Inclusive calendar dates, YYYY-MM-DD. */
	from?: string;
	to?: string;
	/** A category id, or NO_CATEGORY. */
	category?: string | null;
	member?: string;
}

/**
 * Build a link into the ledger showing the rows behind an analytics figure.
 *
 * Always pins basis=spend: analytics figures are sums of completed spending, so
 * the ledger has to read the window the same way or the rows won't add up to
 * the number that was tapped.
 */
export function ledgerLink(slug: string, params: LedgerLinkParams): string {
	const q = new URLSearchParams();
	if (params.from) q.set('from', params.from);
	if (params.to) q.set('to', params.to);
	if (params.category !== undefined) q.set('category', params.category ?? NO_CATEGORY);
	if (params.member) q.set('member', params.member);
	q.set('basis', 'spend');
	return `/w/${slug}/purchases?${q}`;
}
