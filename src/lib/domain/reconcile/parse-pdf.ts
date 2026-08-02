/**
 * Reconstruct statement rows from the text of a PDF.
 *
 * A PDF has no tables. What it has is glyphs at coordinates, and the columns a
 * human sees are an artefact of where those glyphs landed. So this module does
 * what a reader does: gather text that shares a baseline into a row, then work
 * out which part of the row is the date, which the amount, and which the words
 * in between.
 *
 * Two decisions worth stating, because they are what make this tractable.
 *
 * **Rows come from y, columns from the ends.** Inferring column x-ranges from a
 * header sounds principled and fails immediately: issuers right-align amounts,
 * wrap descriptions across two lines, indent continuations, and print running
 * balances in a column that looks exactly like the amount one. What is near
 * universal is that a transaction row opens with a date and closes with a
 * signed amount, with the descriptor between them. Anchoring on the ends is far
 * more robust across issuers than trusting a header we may not even have found.
 *
 * **Everything is a candidate, nothing is a conclusion.** This returns rows and
 * a confidence, and the caller always puts them in front of a person before any
 * of it reaches the ledger — the same stance `match.ts` takes about proposals.
 * A statement layout this has never seen should produce a short list and a low
 * confidence, not a confident set of wrong numbers.
 *
 * Pure: takes positioned text, returns rows. The pdf.js call that produces the
 * text lives in `$lib/reconcile/read-statement-pdf`, client-side, so the file
 * itself never leaves the device.
 */

import type { TextItem } from '$lib/domain/bill/extract';

/** One reconstructed row, still as raw strings. */
export interface PdfRow {
	date: string;
	amount: string;
	description: string;
	/** 1-based page it came off, for reporting. */
	page: number;
}

export interface PdfExtraction {
	rows: PdfRow[];
	/**
	 * 'high' when the page looked like a statement and most of it parsed;
	 * 'low' when little was found. Low does not mean wrong — it means the caller
	 * should lead with the manual path rather than the result.
	 */
	confidence: 'high' | 'low';
	/** How many text rows were considered but yielded no transaction. */
	skipped: number;
}

/**
 * A date at the start of a row. Deliberately broad — the exact format is the
 * CSV parser's problem, and it already reads every one of these. All this has to
 * do is recognise that a date is what it's looking at.
 */
const DATE_AT_START =
	/^(?:\d{1,2}[/\-.]\d{1,2}(?:[/\-.]\d{2,4})?|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{2,4})?|[A-Za-z]{3,9}\s+\d{1,2}(?:,?\s+\d{2,4})?)$/;

/**
 * A money amount. Requires either decimals or a currency symbol: a bare integer
 * is far more likely to be a reference number, a card's last four, or a page
 * number than it is a transaction.
 */
const AMOUNT =
	/^[-+(]?\s*[$£€¥]?\s*\d{1,3}(?:,\d{3})*\.\d{2}\s*[)]?[-+]?$|^[-+(]?\s*[$£€¥]\s*\d+(?:\.\d{1,2})?\s*[)]?$|^[-+(]?\s*\d+[.,]\d{2}\s*[)]?[-+]?$/;

/** Rows that are furniture rather than transactions. */
const NOT_A_TRANSACTION =
	/^(?:page\s+\d|continued|statement\s|opening\s+balance|closing\s+balance|balance\s+(?:brought|carried)|total\s|subtotal|previous\s+balance|new\s+balance|minimum\s+payment|payment\s+due|account\s+(?:number|summary))/i;

function median(ns: number[]): number {
	if (ns.length === 0) return 0;
	const s = [...ns].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)];
}

/**
 * Gather text items sharing a baseline into rows.
 *
 * The tolerance is derived from the document's own type size rather than fixed:
 * a statement set in 7pt and one set in 12pt disagree about how far apart two
 * lines are, and a constant that suits one merges every row of the other.
 */
function toRows(items: TextItem[]): TextItem[][] {
	if (items.length === 0) return [];
	const tolerance = Math.max(1.5, median(items.map((i) => i.fontSize)) * 0.5);

	const byPage = new Map<number, TextItem[]>();
	for (const it of items) {
		if (!it.text.trim()) continue;
		const bucket = byPage.get(it.page);
		if (bucket) bucket.push(it);
		else byPage.set(it.page, [it]);
	}

	const rows: TextItem[][] = [];
	for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
		const sorted = byPage.get(page)!.sort((a, b) => a.y - b.y || a.x - b.x);
		let current: TextItem[] = [];
		let anchor = Number.NaN;
		for (const it of sorted) {
			if (current.length === 0 || Math.abs(it.y - anchor) <= tolerance) {
				if (current.length === 0) anchor = it.y;
				current.push(it);
			} else {
				rows.push(current.sort((a, b) => a.x - b.x));
				current = [it];
				anchor = it.y;
			}
		}
		if (current.length > 0) rows.push(current.sort((a, b) => a.x - b.x));
	}
	return rows;
}

/**
 * Merge items into words, so a date split across items ("12", "/", "03") reads
 * as one token. pdf.js emits runs at its own convenience, not at word breaks.
 */
function tokens(row: TextItem[]): { text: string; x: number }[] {
	const out: { text: string; x: number }[] = [];
	for (const it of row) {
		const text = it.text.trim();
		if (!text) continue;
		const prev = out[out.length - 1];
		const prevItem = prev ? row.find((r) => r.x === prev.x) : null;
		const gap = prevItem ? it.x - (prevItem.x + prevItem.width) : Infinity;
		// A gap narrower than a space means these were one word all along.
		if (prev && gap < it.fontSize * 0.25) prev.text += text;
		else out.push({ text, x: it.x });
	}
	return out;
}

export function extractStatementRows(items: TextItem[]): PdfExtraction {
	const rows = toRows(items);
	const out: PdfRow[] = [];
	let skipped = 0;

	for (const row of rows) {
		const toks = tokens(row);
		if (toks.length < 2) {
			skipped++;
			continue;
		}

		const joined = toks
			.map((t) => t.text)
			.join(' ')
			.trim();
		if (NOT_A_TRANSACTION.test(joined)) {
			skipped++;
			continue;
		}

		// The date: the leading token, or the first two when the day and month
		// were set as separate runs ("12" "March").
		let dateEnd: number;
		let date: string;
		if (DATE_AT_START.test(toks[0].text)) {
			date = toks[0].text;
			dateEnd = 0;
		} else if (toks.length > 1 && DATE_AT_START.test(`${toks[0].text} ${toks[1].text}`)) {
			date = `${toks[0].text} ${toks[1].text}`;
			dateEnd = 1;
		} else {
			skipped++;
			continue;
		}

		/*
		 * The amount: the rightmost money-shaped token. Rightmost matters — a
		 * statement that prints a running balance puts it last, and the transaction
		 * amount second to last, so taking the *first* money token from the left
		 * would read a descriptor's embedded figure instead. Taking the last means
		 * that on a balance-carrying statement we read the balance, which is wrong
		 * in an obvious, visible way the review screen shows plainly — rather than
		 * wrong in a way that looks plausible.
		 */
		let amountAt = -1;
		for (let i = toks.length - 1; i > dateEnd; i--) {
			if (AMOUNT.test(toks[i].text.replace(/\s+/g, ''))) {
				amountAt = i;
				break;
			}
		}
		if (amountAt === -1) {
			skipped++;
			continue;
		}

		const description = toks
			.slice(dateEnd + 1, amountAt)
			.map((t) => t.text)
			.join(' ')
			.trim();
		if (!description) {
			skipped++;
			continue;
		}

		out.push({
			date,
			amount: toks[amountAt].text.replace(/\s+/g, ''),
			description,
			page: row[0].page
		});
	}

	/*
	 * Confidence. A real statement page is mostly transactions once the header and
	 * footer are set aside, so a handful of rows pulled out of hundreds means the
	 * layout was not understood — even though the few that parsed may be perfect.
	 */
	const confidence: 'high' | 'low' =
		out.length >= 3 && out.length >= (out.length + skipped) * 0.15 ? 'high' : 'low';

	return { rows: out, confidence, skipped };
}

/**
 * Serialise extracted rows as a canonical CSV.
 *
 * The PDF path deliberately rejoins the CSV pipeline here rather than building a
 * second one. Every messy date and amount format a bank can emit is already read
 * — and exhaustively tested — by `parse-csv`; teaching a new parser the same
 * lessons would mean two places to fix the next surprise. So a PDF becomes three
 * clean columns and goes through the same door as everything else.
 */
export function rowsToCsv(rows: PdfRow[]): string {
	const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
	return [
		'Date,Amount,Description',
		...rows.map((r) => [r.date, r.amount, r.description].map(escape).join(','))
	].join('\n');
}
