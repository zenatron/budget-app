/**
 * Bill extraction: find the amount due, the dates and the issuer in a document
 * that has already been reduced to positioned text.
 *
 * Deliberately rule-based and self-contained — no model, no network. Bills are
 * templated documents with a small vocabulary, so the useful signal isn't
 * language understanding, it's geometry: "Amount Due" is a label and the number
 * to its right is its value. A parser that flattens the page to a string throws
 * that away and is left guessing between every number on the page.
 *
 * Nothing here knows about PDFs. The caller reduces whatever it has to
 * `TextItem`s; this module is pure so it can be tested against layouts without
 * a rendering engine anywhere in the loop.
 */

/** A run of text with its position on the page. Origin is top-left. */
export interface TextItem {
	text: string;
	x: number;
	y: number;
	width: number;
	height: number;
	/** Rendered font size, used as a proxy for emphasis. */
	fontSize: number;
	/** 1-based. */
	page: number;
}

/** Text items merged into visual lines, which is what labels actually live on. */
export interface Line {
	text: string;
	items: TextItem[];
	x: number;
	y: number;
	page: number;
	maxFontSize: number;
}

export interface MoneyCandidate {
	/** Minor units, e.g. 1999 for 19.99. */
	minor: number;
	/** ISO code if one was stated on the page, else null. */
	currency: string | null;
	score: number;
	page: number;
	/** The line it was found on — shown to the user so a pick can be justified. */
	context: string;
	/** Which rule won, for debugging and for explaining the choice. */
	reason: string;
}

export interface DateCandidate {
	/** ISO 8601 calendar date. */
	date: string;
	score: number;
	/** True when the day/month order could not be determined from the text. */
	ambiguous: boolean;
	context: string;
	kind: 'due' | 'issue' | 'unknown';
}

export interface BillExtraction {
	vendor: string | null;
	total: MoneyCandidate | null;
	/** Runners-up, best first — the confirmation UI offers these as alternates. */
	alternates: MoneyCandidate[];
	dueDate: DateCandidate | null;
	issueDate: DateCandidate | null;
	/** No text layer at all: almost always a scan. */
	isScanned: boolean;
}

/* ── Vocabulary ───────────────────────────────────────────────────────────── */

/**
 * Labels that mark the figure you are actually asked to pay, strongest first.
 * Ordering matters: a bill routinely shows "Total" for the pre-payment sum and
 * "Amount Due" for what is left after a credit, and the second is the one you
 * are writing down.
 */
const DUE_LABELS: { re: RegExp; weight: number }[] = [
	{ re: /\b(amount|balance|total)\s+(now\s+)?due\b/i, weight: 100 },
	{ re: /\b(please\s+pay|amount\s+payable|pay\s+this\s+amount)\b/i, weight: 100 },
	{ re: /\bdue\s+(this|by|on)\b/i, weight: 70 },
	{ re: /\b(total|grand\s+total)\b/i, weight: 55 },
	{ re: /\bnew\s+charges\b/i, weight: 45 },
	{ re: /\bcurrent\s+(charges|bill)\b/i, weight: 45 },
	{ re: /\binvoice\s+total\b/i, weight: 60 }
];

/**
 * Labels whose number is emphatically not the answer. Subtracted rather than
 * used to exclude, because "Total (incl. VAT)" legitimately contains both.
 */
const NEGATIVE_LABELS: { re: RegExp; weight: number }[] = [
	{ re: /\bsub[\s-]?total\b/i, weight: 70 },
	{ re: /\b(vat|gst|sales\s+tax|tax)\b/i, weight: 45 },
	{ re: /\bprevious\s+(balance|bill|payment)\b/i, weight: 80 },
	{ re: /\b(payment|amount)\s+received\b/i, weight: 80 },
	{ re: /\bpaid\b/i, weight: 55 },
	{ re: /\b(credit|refund|discount|adjustment)\b/i, weight: 55 },
	{ re: /\b(per|rate|unit|kwh|hourly|each)\b/i, weight: 50 },
	{ re: /\blast\s+(month|bill|year)\b/i, weight: 45 },
	{ re: /\b(account|invoice|reference|customer)\s*(no|number|#)/i, weight: 60 }
];

const DUE_DATE_LABELS = /\b(due\s+date|payment\s+due|due\s+(by|on)|pay\s+by)\b/i;
const ISSUE_DATE_LABELS =
	/\b(invoice\s+date|bill\s+date|statement\s+date|issue(d)?\s+(date|on)|date\s+of\s+issue)\b/i;

/** Symbols we can map to a currency without guessing. */
const CURRENCY_SYMBOLS: Record<string, string> = {
	$: 'USD',
	'£': 'GBP',
	'€': 'EUR',
	'¥': 'JPY',
	'₹': 'INR',
	'₽': 'RUB',
	'₺': 'TRY',
	R$: 'BRL',
	元: 'CNY'
};

const CURRENCY_CODES =
	/\b(USD|EUR|GBP|JPY|CAD|AUD|NZD|CHF|SEK|NOK|DKK|PLN|CZK|INR|BRL|MXN|ZAR|CNY|HKD|SGD)\b/;

/* ── Line reconstruction ──────────────────────────────────────────────────── */

/**
 * Group items into visual lines. Baselines jitter by a point or two within a
 * line, so items are banded by y with a tolerance that scales with type size
 * rather than a fixed pixel figure — a 24pt heading and 8pt small print need
 * very different tolerances.
 */
export function toLines(items: TextItem[]): Line[] {
	const byPage = new Map<number, TextItem[]>();
	for (const it of items) {
		if (!it.text.trim()) continue;
		const list = byPage.get(it.page);
		if (list) list.push(it);
		else byPage.set(it.page, [it]);
	}

	const lines: Line[] = [];
	for (const [page, pageItems] of [...byPage.entries()].sort((a, b) => a[0] - b[0])) {
		const sorted = [...pageItems].sort((a, b) => a.y - b.y || a.x - b.x);
		let current: TextItem[] = [];
		let bandY = 0;
		let tolerance = 0;

		const flush = () => {
			if (current.length === 0) return;
			const ordered = [...current].sort((a, b) => a.x - b.x);
			lines.push({
				// Join with a space unless the runs already touch: PDFs split words
				// mid-token constantly, and "Amount" + "Due" must not become
				// "AmountDue" while "1,234" + ".56" must not become "1,234 .56".
				text: ordered
					.map((i, idx) => {
						if (idx === 0) return i.text;
						const prev = ordered[idx - 1];
						const gap = i.x - (prev.x + prev.width);
						return (gap > prev.fontSize * 0.25 ? ' ' : '') + i.text;
					})
					.join('')
					.replace(/\s+/g, ' ')
					.trim(),
				items: ordered,
				x: ordered[0].x,
				y: ordered[0].y,
				page,
				maxFontSize: Math.max(...ordered.map((i) => i.fontSize))
			});
			current = [];
		};

		for (const it of sorted) {
			if (current.length === 0) {
				current = [it];
				bandY = it.y;
				tolerance = Math.max(it.fontSize * 0.5, 2);
				continue;
			}
			if (Math.abs(it.y - bandY) <= tolerance) {
				current.push(it);
				tolerance = Math.max(tolerance, it.fontSize * 0.5);
			} else {
				flush();
				current = [it];
				bandY = it.y;
				tolerance = Math.max(it.fontSize * 0.5, 2);
			}
		}
		flush();
	}
	return lines;
}

/* ── Money ────────────────────────────────────────────────────────────────── */

const MONEY_RE =
	/(?:(R\$|[$£€¥₹₽₺])\s*)?(\d{1,3}(?:[.,\u00a0\s]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?:\s*(USD|EUR|GBP|JPY|CAD|AUD|CHF|INR|BRL|SEK|NOK|DKK))?/gi;

/**
 * Parse a number that might be written 1,234.56 or 1.234,56.
 *
 * The separators are only ambiguous when there is exactly one of them and it is
 * followed by three digits — "1,234" and "1.234" could each be a thousand or a
 * fraction. Everything else is decidable: whichever separator appears last is
 * the decimal one.
 */
export function parseAmount(raw: string): number | null {
	const s = raw.replace(/[\u00a0\s]/g, '');
	if (!/\d/.test(s)) return null;

	const lastComma = s.lastIndexOf(',');
	const lastDot = s.lastIndexOf('.');

	let normalized: string;
	if (lastComma === -1 && lastDot === -1) {
		normalized = s;
	} else if (lastComma > -1 && lastDot > -1) {
		// Both present: the later one is the decimal separator.
		const decimalAt = Math.max(lastComma, lastDot);
		normalized = s.slice(0, decimalAt).replace(/[.,]/g, '') + '.' + s.slice(decimalAt + 1);
	} else {
		const sep = lastComma > -1 ? ',' : '.';
		const after = s.length - s.lastIndexOf(sep) - 1;
		// Exactly three trailing digits reads as a group separator (1.234), any
		// other length as a decimal point (1.2, 1.23). Grouping is the commoner
		// meaning at exactly three, and a bill quoting 1.234 to three decimals is
		// vanishingly rare next to one quoting a thousand.
		normalized = after === 3 ? s.replace(/[.,]/g, '') : s.replace(sep, '.');
	}

	const value = Number(normalized);
	if (!Number.isFinite(value)) return null;
	return Math.round(value * 100);
}

function labelScore(text: string): { score: number; reason: string } {
	let score = 0;
	let reason = '';
	for (const { re, weight } of DUE_LABELS) {
		if (re.test(text)) {
			if (weight > score) {
				score = weight;
				reason = `matched ${re.source}`;
			}
		}
	}
	for (const { re, weight } of NEGATIVE_LABELS) {
		if (re.test(text)) score -= weight;
	}
	return { score, reason };
}

function detectCurrency(text: string): string | null {
	const code = text.match(CURRENCY_CODES);
	if (code) return code[1].toUpperCase();
	for (const [symbol, iso] of Object.entries(CURRENCY_SYMBOLS)) {
		if (text.includes(symbol)) return iso;
	}
	return null;
}

/**
 * Score every money-shaped token on the page.
 *
 * A value is judged by the company it keeps: the label on its own line, then
 * the line above (bills often stack a label over its figure), then typography
 * and position. Taking the largest number instead is the obvious shortcut and
 * it fails on any bill that prints a year-to-date figure or a prior balance.
 */
export function findAmounts(lines: Line[]): MoneyCandidate[] {
	const out: MoneyCandidate[] = [];
	const maxFont = Math.max(1, ...lines.map((l) => l.maxFontSize));

	lines.forEach((line, idx) => {
		const above = idx > 0 && lines[idx - 1].page === line.page ? lines[idx - 1] : null;
		const own = labelScore(line.text);
		const stacked = above ? labelScore(above.text) : { score: 0, reason: '' };

		MONEY_RE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = MONEY_RE.exec(line.text)) !== null) {
			const [, symbol, digits, code] = m;
			const minor = parseAmount(digits);
			if (minor === null || minor <= 0) continue;

			// A bare integer with no separators, no symbol and no label is almost
			// always a reference number, a meter reading or a quantity.
			const hasDecimals = /[.,]\d{1,2}$/.test(digits);
			const hasSymbol = Boolean(symbol || code);
			if (!hasDecimals && !hasSymbol && own.score <= 0 && stacked.score <= 0) continue;

			let score = 0;
			let reason = '';
			if (own.score !== 0) {
				score += own.score;
				reason = own.reason || reason;
			}
			// A label stacked above counts for less than one on the same line:
			// vertical association is weaker evidence than horizontal.
			if (stacked.score > 0) {
				score += stacked.score * 0.6;
				reason = reason || stacked.reason;
			}
			if (hasSymbol) score += 20;
			if (hasDecimals) score += 15;
			// Emphasis: the figure you owe is usually the biggest type on the page.
			score += (line.maxFontSize / maxFont) * 25;
			// Bills lead with the headline; ledgers and breakdowns come after.
			if (line.page === 1) score += 15;

			out.push({
				minor,
				currency: detectCurrency(line.text) ?? detectCurrency(above?.text ?? '') ?? null,
				score,
				page: line.page,
				context: line.text.slice(0, 120),
				reason: reason || 'position and formatting'
			});
		}
	});

	return out.sort((a, b) => b.score - a.score || b.minor - a.minor);
}

/* ── Dates ────────────────────────────────────────────────────────────────── */

const MONTH_NAMES = [
	'jan',
	'feb',
	'mar',
	'apr',
	'may',
	'jun',
	'jul',
	'aug',
	'sep',
	'oct',
	'nov',
	'dec'
];

const NUMERIC_DATE = /\b(\d{1,4})[/.-](\d{1,2})[/.-](\d{2,4})\b/g;
const NAMED_DATE =
	/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b|\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g;

function iso(y: number, m: number, d: number): string | null {
	if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * `dayFirst` resolves 03/04/2026, which is a real ambiguity and not one the
 * document can settle — the caller passes the workspace's convention, and
 * anything still ambiguous is flagged so the UI can ask rather than assume.
 */
export function findDates(lines: Line[], dayFirst: boolean): DateCandidate[] {
	const out: DateCandidate[] = [];

	for (const line of lines) {
		const kind: DateCandidate['kind'] = DUE_DATE_LABELS.test(line.text)
			? 'due'
			: ISSUE_DATE_LABELS.test(line.text)
				? 'issue'
				: 'unknown';
		const base = kind === 'due' ? 100 : kind === 'issue' ? 80 : 10;

		NUMERIC_DATE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = NUMERIC_DATE.exec(line.text)) !== null) {
			const a = Number(m[1]);
			const b = Number(m[2]);
			let y = Number(m[3]);
			if (m[1].length === 4) {
				// ISO: 2026-06-12, never ambiguous.
				const d = iso(a, b, y);
				if (d)
					out.push({
						date: d,
						score: base + 10,
						ambiguous: false,
						context: line.text.slice(0, 120),
						kind
					});
				continue;
			}
			if (y < 100) y += y < 70 ? 2000 : 1900;

			// >12 settles it whichever position it is in; otherwise fall back to the
			// stated convention and mark it as a guess.
			let day: number, month: number, ambiguous: boolean;
			if (a > 12) {
				day = a;
				month = b;
				ambiguous = false;
			} else if (b > 12) {
				day = b;
				month = a;
				ambiguous = false;
			} else {
				day = dayFirst ? a : b;
				month = dayFirst ? b : a;
				ambiguous = true;
			}
			const d = iso(y, month, day);
			if (d) out.push({ date: d, score: base, ambiguous, context: line.text.slice(0, 120), kind });
		}

		NAMED_DATE.lastIndex = 0;
		while ((m = NAMED_DATE.exec(line.text)) !== null) {
			// Either "12 June 2026" (groups 1-3) or "June 12, 2026" (groups 4-6).
			const day = Number(m[1] ?? m[5]);
			const monthName = (m[2] ?? m[4] ?? '').slice(0, 3).toLowerCase();
			const year = Number(m[3] ?? m[6]);
			const month = MONTH_NAMES.indexOf(monthName) + 1;
			if (month === 0) continue;
			const d = iso(year, month, day);
			// Spelled-out months can't be misread, so they beat numeric forms.
			if (d)
				out.push({
					date: d,
					score: base + 15,
					ambiguous: false,
					context: line.text.slice(0, 120),
					kind
				});
		}
	}

	return out.sort((a, b) => b.score - a.score);
}

/* ── Vendor ───────────────────────────────────────────────────────────────── */

const NOT_A_VENDOR =
	/\b(invoice|bill|statement|receipt|tax|account|customer|page|date|due|total|amount|summary|please|thank)\b/i;

/**
 * The issuer's name, taken from the largest type in the top third of page one —
 * where letterheads live. Document metadata is a better source when it exists,
 * so the caller passes it and this is the fallback.
 */
export function findVendor(lines: Line[]): string | null {
	const firstPage = lines.filter((l) => l.page === 1);
	if (firstPage.length === 0) return null;

	const maxY = Math.max(...firstPage.map((l) => l.y));
	const header = firstPage.filter((l) => l.y <= maxY * 0.33);
	const pool = header.length > 0 ? header : firstPage.slice(0, 12);

	const best = pool
		.filter((l) => {
			const t = l.text.trim();
			return (
				t.length >= 2 &&
				t.length <= 60 &&
				/[A-Za-z]{2}/.test(t) &&
				!NOT_A_VENDOR.test(t) &&
				// Skip anything dominated by digits — addresses, phone numbers, refs.
				t.replace(/\D/g, '').length / t.length < 0.3
			);
		})
		.sort((a, b) => b.maxFontSize - a.maxFontSize || a.y - b.y)[0];

	return best ? best.text.trim() : null;
}

/* ── Entry point ──────────────────────────────────────────────────────────── */

export function extractBill(
	items: TextItem[],
	opts: { dayFirst?: boolean; metadataTitle?: string | null } = {}
): BillExtraction {
	// No text layer at all means a scan. Saying so is far better than returning
	// empty fields that look like a parser that simply failed.
	if (items.length === 0) {
		return {
			vendor: null,
			total: null,
			alternates: [],
			dueDate: null,
			issueDate: null,
			isScanned: true
		};
	}

	const lines = toLines(items);
	const amounts = findAmounts(lines);
	const dates = findDates(lines, opts.dayFirst ?? false);

	const metaTitle = opts.metadataTitle?.trim();
	const vendor =
		metaTitle && metaTitle.length <= 60 && !NOT_A_VENDOR.test(metaTitle)
			? metaTitle
			: findVendor(lines);

	// Distinct values only: the same figure printed in a summary and again in a
	// payment slip is one candidate, not two.
	const seen = new Set<number>();
	const distinct = amounts.filter((a) => {
		if (seen.has(a.minor)) return false;
		seen.add(a.minor);
		return true;
	});

	/*
	 * Alternates are ranked by size, not by score.
	 *
	 * Score ordering is right for picking the winner, but wrong for the fallback:
	 * it pushes the figures we deliberately penalised — subtotal, previous
	 * balance — below unlabelled line items, so a misread bill offered "standing
	 * charge £8.30" while hiding the subtotal. When the top pick is wrong the
	 * intended figure is nearly always another *total*, and totals are the large
	 * numbers on the page.
	 */
	const alternates = distinct.slice(1).sort((a, b) => b.minor - a.minor);

	return {
		vendor,
		total: distinct[0] ?? null,
		alternates: alternates.slice(0, 3),
		dueDate: dates.find((d) => d.kind === 'due') ?? null,
		issueDate: dates.find((d) => d.kind === 'issue') ?? null,
		isScanned: false
	};
}
