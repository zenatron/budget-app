/**
 * Parse a spoken or typed sentence into the fields of a purchase — "23 bucks on
 * lunch at chipotle yesterday" → amount 23, item "lunch", merchant "Chipotle",
 * yesterday, logged.
 *
 * The rule that matters: the *money and the date are extracted deterministically
 * here and never by a model*. A misheard "$230" for "$23" must come from you, not
 * from a language model's guess — the same reason Safe to Spend is pure integer
 * arithmetic. A model may later refine the fuzzy leftovers (a cleaner item name,
 * a category), but the number and the day are decided by these rules alone.
 *
 * Pure and tested. Everything it returns lands in the form as editable fields;
 * nothing is ever submitted from here.
 */

export interface ParsedPurchase {
	/** Decimal amount string (e.g. "23.50"), or null. Caller converts to minor. */
	amount: string | null;
	/** Days before today the purchase happened: 0 today, -1 yesterday, … */
	dateOffsetDays: number;
	/** Human label for the date, or null when none was said. */
	dateLabel: string | null;
	/** Whether it reads as already spent (log) or a request to make (ask first). */
	intent: 'log' | 'request';
	/** The item, with amount/date/merchant/filler stripped. May be empty. */
	itemName: string;
	/** Merchant named with "at"/"from", or null. */
	merchantName: string | null;
}

const REQUEST_CUES =
	/\b(can i|should i|shall i|may i|thinking of|want to buy|would like to|need approval|ask (?:first|about)|is it ok|do you think)\b/i;

/** Extract the first plausible money amount as a decimal string. */
function extractAmount(text: string): { amount: string | null; span: [number, number] | null } {
	// 1) An explicit currency marker is the strongest signal: $23, £4.50, €10.
	const sym = /(?:[$£€])\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/.exec(text);
	if (sym) return { amount: sym[1].replace(/,/g, ''), span: [sym.index, sym.index + sym[0].length] };

	// 2) A number followed by a money word: "23 dollars", "5 bucks".
	const word = /\b(\d+(?:\.\d{1,2})?)\s?(dollars?|bucks?|quid|euros?|pounds?)\b/i.exec(text);
	if (word) return { amount: word[1], span: [word.index, word.index + word[0].length] };

	// 3) A bare decimal reads as money far more than as anything else: "4.50".
	const dec = /\b(\d+\.\d{1,2})\b/.exec(text);
	if (dec) return { amount: dec[1], span: [dec.index, dec.index + dec[0].length] };

	// 4) A bare integer, but never one that is really a date ("3 days ago",
	//    "the 3rd", "2 weeks"). Skip integers glued to time words.
	const re = /\b(\d{1,6})\b/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		const after = text.slice(m.index + m[0].length, m.index + m[0].length + 12).toLowerCase();
		const before = text.slice(Math.max(0, m.index - 4), m.index).toLowerCase();
		if (/^\s*(days?|weeks?|months?|years?|hours?|min)/.test(after)) continue; // "3 days ago"
		if (/(the\s+)$/.test(before) && /^(st|nd|rd|th)/.test(after)) continue; // "the 3rd"
		return { amount: m[1], span: [m.index, m.index + m[0].length] };
	}
	return { amount: null, span: null };
}

/** Extract a relative date. Only unambiguous, common phrases — never a guess. */
function extractDate(text: string): {
	offset: number;
	label: string | null;
	span: [number, number] | null;
} {
	const t = text.toLowerCase();
	const patterns: { re: RegExp; offset: (m: RegExpExecArray) => number; label: string }[] = [
		{ re: /\bthe day before yesterday\b/, offset: () => -2, label: 'the day before yesterday' },
		{ re: /\byesterday\b/, offset: () => -1, label: 'yesterday' },
		{ re: /\btoday\b/, offset: () => 0, label: 'today' },
		{ re: /\b(\d{1,3})\s+days?\s+ago\b/, offset: (m) => -Number(m[1]), label: 'days ago' },
		{ re: /\b(\d{1,2})\s+weeks?\s+ago\b/, offset: (m) => -7 * Number(m[1]), label: 'weeks ago' }
	];
	for (const p of patterns) {
		const m = p.re.exec(t);
		if (m) {
			const label = p.label.includes('ago') ? m[0] : p.label;
			return { offset: p.offset(m), label, span: [m.index, m.index + m[0].length] };
		}
	}
	return { offset: 0, label: null, span: null };
}

/** Extract a merchant named with "at"/"from", stopping at a natural boundary. */
function extractMerchant(text: string): { merchant: string | null; span: [number, number] | null } {
	const m = /\b(?:at|from)\s+([A-Za-z0-9&'.\- ]+?)(?=\s+(?:yesterday|today|for|on|and|,|\d)|$)/i.exec(
		text
	);
	if (!m) return { merchant: null, span: null };
	const merchant = titleCase(m[1].trim());
	return merchant ? { merchant, span: [m.index, m.index + m[0].length] } : { merchant: null, span: null };
}

function titleCase(s: string): string {
	return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Blank out a span with spaces of *equal length*, so the spans of the other
 * extractions (all computed against the original string) stay valid no matter
 * the order we blank in. Collapsing to a single space would shift every later
 * index left and strand fragments in the residual.
 */
function blank(text: string, span: [number, number] | null): string {
	if (!span) return text;
	return text.slice(0, span[0]) + ' '.repeat(span[1] - span[0]) + text.slice(span[1]);
}

const FILLER =
	/^(?:i\s+)?(?:just\s+)?(?:bought|spent|paid(?:\s+for)?|got|grabbed|picked up|log|logged|add|added|buy|purchase[d]?|for|on|a|an|the|some|of|money|dollars?|bucks?)\b/i;

export function parsePurchaseText(text: string): ParsedPurchase {
	const original = text.trim();
	const intent: ParsedPurchase['intent'] = REQUEST_CUES.test(original) ? 'request' : 'log';

	const amt = extractAmount(original);
	const date = extractDate(original);
	const merch = extractMerchant(original);

	// Strip everything structured, leaving the item as the residual text.
	let residual = original;
	residual = blank(residual, amt.span);
	residual = blank(residual, date.span);
	residual = blank(residual, merch.span);
	residual = residual
		.replace(REQUEST_CUES, ' ')
		.replace(/[$£€]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	// Peel leading filler words ("i bought a", "spent on", …) one at a time.
	let prev: string;
	do {
		prev = residual;
		residual = residual.replace(FILLER, '').trim();
	} while (residual !== prev && residual.length > 0);

	// Then peel trailing prepositions left dangling where a stripped amount or
	// date used to be ("book for" ← "book for 15 dollars").
	do {
		prev = residual;
		residual = residual.replace(/\s*\b(?:for|on|at|and|of|the|a|an|to|with|some)\s*$/i, '').trim();
	} while (residual !== prev && residual.length > 0);

	return {
		amount: amt.amount,
		dateOffsetDays: date.offset,
		dateLabel: date.label,
		intent,
		itemName: residual,
		merchantName: merch.merchant
	};
}
