/**
 * Is this document a bill, or a statement someone brought to the wrong door?
 *
 * The first version of this was a row count: eight or more transaction-shaped
 * rows meant "statement". That is wrong in the direction that matters. A new
 * account's first statement, or a card used twice in a month, has one or two
 * transactions on it — and would have fallen through to the bill reader, which
 * would then either dead-end on "couldn't find an amount" or, worse, find one.
 * A statement's closing balance is a number next to the word "balance", and a
 * bill reader looking for the figure you owe will happily take it. Prefilling a
 * purchase with somebody's closing balance is a silent, plausible, wrong answer
 * — exactly the failure everything else in this codebase is arranged to avoid.
 *
 * So the question is not "how many rows" but "what shape is this document".
 *
 * The signals are genuinely different in kind:
 *
 * - **A statement row leads with a date.** `extractStatementRows` will not
 *   accept a row otherwise. A bill's line items — "Electricity supply 182.40" —
 *   almost never do, because the date belongs to the bill, not to the line. So
 *   even one or two date-led rows is meaningful evidence rather than noise.
 * - **A bill names what you owe.** "Amount due", "please pay", "total" — the
 *   labels `DUE_LABELS` scores. A statement has no such figure, because a
 *   statement is not asking you for money.
 *
 * When both are present, or neither, the honest answer is that we do not know —
 * and the caller should ask rather than guess. A one-transaction statement and a
 * receipt genuinely do look alike, and a wrong guess costs more than a tap.
 */

import type { BillExtraction } from './extract';

export type DocumentShape = 'bill' | 'statement' | 'ambiguous';

/**
 * A total this confident was found under a label that means "pay this". Below
 * it, the figure is a best guess from position and size, which is not enough to
 * outweigh a page full of dated rows.
 */
const CONFIDENT_TOTAL = 55;

/**
 * Enough dated rows that nothing else explains them. A bill with this many
 * date-led amount rows is not a bill any more; it is an itemised statement, and
 * reconciling it is the more useful thing to do with it either way.
 */
const DECISIVE_ROWS = 5;

export interface ClassifyInput {
	/** What the bill reader made of it. */
	bill: Pick<BillExtraction, 'total'>;
	/** Rows `extractStatementRows` accepted — each led with a date and an amount. */
	statementRows: number;
}

export function classifyDocument({ bill, statementRows }: ClassifyInput): DocumentShape {
	const confidentTotal = (bill.total?.score ?? 0) >= CONFIDENT_TOTAL;

	// Nothing transaction-shaped on the page. Whatever it is, it is not a
	// statement, and the bill reader is the only thing that can help.
	if (statementRows === 0) return 'bill';

	// A page of dated rows. Even a labelled "total" here is a statement's own
	// summary line, not an invoice — the rows outweigh it.
	if (statementRows >= DECISIVE_ROWS) return 'statement';

	// A handful of dated rows and a figure that says "pay this". Both stories
	// hold: an itemised invoice with dated services, or a very short statement
	// whose closing balance we have mistaken for a demand. Ask.
	if (confidentTotal) return 'ambiguous';

	// Dated rows and nothing asking to be paid. A short statement.
	return 'statement';
}
