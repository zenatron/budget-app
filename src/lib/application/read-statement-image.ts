/**
 * Read a scanned bank statement page — the last and most dangerous thing this
 * layer does, and the one worth being most explicit about.
 *
 * **Why this is allowed at all.** Reconciliation never creates, edits, or
 * deletes a purchase. `confirmMatch` is the only writer in the whole flow and
 * all it does is set `cleared_at` on a purchase whose amount a *person* typed. A
 * statement line is evidence, not a ledger entry. So a misread figure does not
 * become a plausible-looking wrong number in the ledger — it fails to match
 * anything and surfaces as an unmatched line for someone to look at. That is a
 * materially different risk from letting a model read a bill, and it is why the
 * order of the fields below matters less than the fact that nothing downstream
 * trusts them.
 *
 * **Where the danger actually is**, and what is done about it:
 *
 * 1. *Coincidental collision.* A misread amount that happens to equal a
 *    different purchase on the same day produces a wrong match a careless person
 *    might confirm. Mitigated twice: `matchLines` already refuses ambiguous ties
 *    rather than coin-flipping, and a model-read import is marked as such
 *    through the entire review so every row is read with that in mind.
 * 2. *Silent confabulation.* If the image never reaches the model — which is
 *    exactly what happened with WebP and Ollama — it answers a statement-shaped
 *    question with a statement-shaped invention. `toModelImage` closes the known
 *    cause, but no code here can *detect* the general case: a fabricated page of
 *    transactions is indistinguishable from a real one at this layer. So this
 *    module does not pretend to. It reads the statement's own header alongside
 *    the rows and hands both back, so the caller can show a person their bank's
 *    name, their account, and their period *before* anything is imported. A
 *    human recognises a statement that isn't theirs instantly, and that is a
 *    stronger check than any heuristic available here.
 * 3. *A future "add this bank line to the ledger" feature.* That would cross the
 *    line, because it would put a model-derived amount into the ledger directly.
 *    A model-read import must be barred from it. There is nothing to guard yet —
 *    no such feature exists — so `modelRead` is carried on the import for the
 *    guard to be written against when there is.
 */

import type { ImageInput, LlmAssist } from '$lib/ports/llm-assist';
import { coerceFields, coerceRows } from '$lib/domain/intelligence/read-fields';
import type { PdfRow } from '$lib/domain/reconcile/parse-pdf';

/** Bounded: a page of a statement, not a year of one. */
const MAX_ROWS_PER_PAGE = 60;

const ROW_COLUMNS = [
	{ key: 'date', description: 'posting date, exactly as printed' },
	{
		key: 'amount',
		description: 'amount, exactly as printed, including any minus sign or brackets'
	},
	{ key: 'description', description: 'the transaction description, as printed' }
];

const ROW_SPEC = [
	{ key: 'date', kind: 'date' },
	{ key: 'amount', kind: 'money' },
	{ key: 'description', kind: 'text' }
] as const;

const HEADER_SPEC = [
	{ key: 'bank', kind: 'text' },
	{ key: 'account', kind: 'text' },
	{ key: 'period', kind: 'text' }
] as const;

const ROWS_INSTRUCTION =
	'This is a photograph or scan of one page of a bank or card statement. ' +
	'Transcribe the transaction rows on it: the posting date, the amount, and the ' +
	'description of each. ' +
	'Copy every value exactly as printed — do not convert dates, do not add up ' +
	'amounts, do not tidy descriptions. ' +
	'Include only transaction rows: skip headings, running balances, page ' +
	'footers, and any summary or total lines. ' +
	'If the page has no transaction rows, return an empty list.';

const HEADER_INSTRUCTION =
	'This is a photograph or scan of one page of a bank or card statement. ' +
	'Read only the identifying details printed on it: the name of the bank or ' +
	'card issuer, the account or card number as shown (usually partly masked), ' +
	'and the statement period. ' +
	'Copy each exactly as printed. If one is not visible on this page, leave it blank.';

/**
 * What the page said about itself. Shown to a person before anything is
 * imported — this is the confabulation check, and it is deliberately a human
 * one. Nothing downstream consumes these values.
 */
export interface StatementHeader {
	bank?: string;
	account?: string;
	period?: string;
}

export interface StatementImageReading {
	rows: PdfRow[];
	header: StatementHeader;
}

/** Minor units back to the plain decimal string `rowsToCsv` and `parseCsv` expect. */
function decimalOf(minor: bigint): string {
	const neg = minor < 0n;
	const abs = neg ? -minor : minor;
	const whole = abs / 100n;
	const frac = String(abs % 100n).padStart(2, '0');
	return `${neg ? '-' : ''}${whole}.${frac}`;
}

/**
 * Read one page. Rows come back in the exact `PdfRow` shape the text path
 * produces, so everything downstream — `rowsToCsv`, `parseCsv`, `matchLines` —
 * is completely unchanged and has no idea a model was involved.
 */
export async function readStatementPage(
	assist: LlmAssist,
	image: ImageInput,
	opts: { page: number; currency: string; dayFirst?: boolean; withHeader?: boolean }
): Promise<StatementImageReading> {
	if (!assist.available) return { rows: [], header: {} };

	const [rawRows, rawHeader] = await Promise.all([
		assist.readRows({
			instruction: ROWS_INSTRUCTION,
			image,
			columns: ROW_COLUMNS,
			maxRows: MAX_ROWS_PER_PAGE
		}),
		opts.withHeader
			? assist.readFields({
					instruction: HEADER_INSTRUCTION,
					image,
					fields: [
						{ key: 'bank', description: 'bank or card issuer name' },
						{ key: 'account', description: 'account or card number as shown' },
						{ key: 'period', description: 'statement period, as printed' }
					]
				})
			: Promise.resolve(null)
	]);

	const coerced = coerceRows(rawRows, ROW_SPEC, opts);
	const rows: PdfRow[] = [];
	for (const r of coerced) {
		// A row missing its date or its amount is not a transaction we can import.
		// The description may be empty — plenty of statements print a bare code —
		// but the two figures that decide a match are not optional.
		if (r.date === undefined || r.amount === undefined) continue;
		rows.push({
			date: r.date,
			amount: decimalOf(r.amount),
			description: r.description ?? '',
			page: opts.page
		});
	}

	return { rows, header: coerceFields(rawHeader, HEADER_SPEC, opts) };
}
