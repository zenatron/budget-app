/**
 * The seam where a model's transcription of an image becomes typed data — or,
 * far more often than people expect, becomes nothing.
 *
 * `readFields` and `readRows` promise only strings. That promise is what makes
 * vision safe to have at all, and this module is where it is cashed in: every
 * value is handed to the *same deterministic parser the app already uses* on
 * text it read itself. Money goes through `parseAmount`, the module that knows
 * `1.234,56` from `1,234.56`. Dates go through `findDates`, the module that
 * knows a due date from an invoice date and refuses an impossible one. Text goes
 * through `sanitizeLabel`, the same guard every other model output passes.
 *
 * The consequence is the whole point. A model that reads "$1,240.50" gives us
 * 124050 minor units, because our parser says so. A model that answers "twelve
 * dollars and fifty cents", or "about 1240", or "1,2,3.4.5", or "$1240.50 (see
 * note 3)" gives us **nothing** — the key is simply absent from the result, and
 * the caller shows an empty field for a person to fill. It cannot give us a
 * *wrong number*, because it was never in a position to hand us a number at all.
 *
 * Pure, and tested with no network anywhere near it.
 */

import { parseAmount, findDates, type Line } from '$lib/domain/bill/extract';
import { sanitizeLabel } from './constrain';
import { Money } from '$lib/domain/money/money';

export type FieldKind = 'money' | 'date' | 'text';

export interface FieldSpec<K extends string = string> {
	key: K;
	kind: FieldKind;
}

type ValueOf<T extends FieldKind> = T extends 'money' ? bigint : T extends 'date' ? string : string;

/**
 * The shape a spec produces. Every key optional, because "the model didn't give
 * us anything we could use" is the normal case, not an error case.
 */
export type Coerced<S extends readonly FieldSpec[]> = {
	[E in S[number] as E['key']]?: ValueOf<E['kind']>;
};

export interface CoerceOptions {
	/** Decides the minor-unit exponent, so JPY isn't given cents. */
	currency: string;
	/** The workspace's convention for 03/04/2026. See `findDates`. */
	dayFirst?: boolean;
}

/**
 * Largest figure we will accept off an image: ten million major units.
 *
 * Not arbitrary caution — a misread decimal point is the characteristic vision
 * failure ("1,240.50" read as "124050"), and it is exactly the failure that a
 * plausible-looking number makes hard to catch by eye. Anything past this is far
 * likelier to be a misread than a real household bill, and the cost of refusing
 * is that someone types it in.
 */
const MAX_MINOR = 10_000_000n * 100n;

/**
 * A decimal string for `Money.fromDecimal`, from `parseAmount`'s minor units.
 *
 * `parseAmount` works in hundredths because that is what bills are written in.
 * Handing the result back as a decimal and letting `Money` re-read it means the
 * *currency's* exponent has the last word: a JPY bill quoting whole yen parses,
 * and a JPY bill quoting cents is refused rather than silently rounded, which is
 * the right way round for a figure nobody typed.
 */
function decimalFromHundredths(minor: number): string {
	const neg = minor < 0;
	const abs = Math.abs(minor);
	const whole = Math.trunc(abs / 100);
	const frac = String(abs % 100).padStart(2, '0');
	const body = frac === '00' ? String(whole) : `${whole}.${frac}`.replace(/0$/, '');
	return neg ? `-${body}` : body;
}

/**
 * A cell that is money and *nothing else*.
 *
 * Deliberately anchored, where the bill extractor's own regex scans for money
 * inside a line of prose. The difference is the input: the extractor is reading
 * a page it must find figures in, so it searches; here the model was asked for
 * one value and one value only, so anything around that value is evidence the
 * model didn't do what was asked. "definitely $500 (approx)" contains a number,
 * but a model hedging in the answer field is exactly the case where trusting the
 * number is least warranted — so it reads as nothing.
 *
 * Accepts a sign, the accountants' parenthesised negative, and a currency marker
 * on **either side** — a symbol or an ISO code, before or after. All four
 * combinations are ordinary on real bills, and a model asked to copy a total
 * hands back whichever the page used; refusing "USD 125.00" while accepting
 * "125.00 USD" would be an arbitrary way to lose a good read. The numeric core
 * then goes to `parseAmount`, which owns the separator question.
 */
const MONEY_CELL = /^\s*(?:\((?<paren>.+)\)|(?<plain>.+?))\s*$/;
const CURRENCY_MARK = 'R\\$|[$£€¥₹₽₺]|USD|EUR|GBP|JPY|CAD|AUD|CHF|INR|BRL|SEK|NOK|DKK';
const MONEY_BODY = new RegExp(
	`^(?:(?:${CURRENCY_MARK})\\s*)?(?<sign>[-+])?\\s*` +
		`(?<num>\\d{1,3}(?:[.,\\u00a0\\s]\\d{3})*(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)` +
		`\\s*(?:${CURRENCY_MARK})?$`,
	'i'
);

/** Money, or nothing. Never a number we weren't confident about. */
export function coerceMoney(raw: string, currency: string): bigint | null {
	const outer = MONEY_CELL.exec(raw);
	if (!outer) return null;
	const parenthesised = outer.groups?.paren !== undefined;
	const body = MONEY_BODY.exec(outer.groups?.paren ?? outer.groups?.plain ?? '');
	if (!body?.groups?.num) return null;

	const negative = parenthesised || body.groups.sign === '-';
	const hundredths = parseAmount(body.groups.num);
	if (hundredths === null) return null;
	// A bill can say "0.00"; a transcription that decays to zero is far more
	// often a failed read, and a zero total helps nobody. Refuse it either way.
	if (hundredths === 0) return null;
	try {
		const money = Money.fromDecimal(
			decimalFromHundredths(negative ? -hundredths : hundredths),
			currency
		);
		const magnitude = money.minor < 0n ? -money.minor : money.minor;
		if (magnitude > MAX_MINOR) return null;
		return money.minor;
	} catch {
		// The currency wouldn't take it — wrong precision, bad code. Nothing, then.
		return null;
	}
}

/**
 * An ISO calendar date, or nothing. Kept as `YYYY-MM-DD` rather than a `Date`
 * on purpose: a bill's date is a calendar day, and turning it into an instant
 * here would silently attach whichever timezone the server happens to run in.
 * The caller resolves it in the workspace's zone, as it does everywhere else.
 */
export function coerceDate(raw: string, dayFirst = false): string | null {
	const cleaned = sanitizeLabel(raw, 60);
	if (!cleaned) return null;
	// One synthetic line, so the app's own date parsing does the reading. It
	// scores labelled dates above bare ones; with a single unlabelled string
	// every candidate scores the same, so the first found wins — which for a
	// one-value cell is the only one there is.
	const line: Line = { text: cleaned, items: [], x: 0, y: 0, page: 1, maxFontSize: 10 };
	const found = findDates([line], dayFirst);
	if (found.length === 0) return null;
	const best = [...found].sort((a, b) => b.score - a.score)[0];
	return best.date;
}

/** A short clean string, or nothing. The same guard every model output passes. */
export function coerceText(raw: string, maxLen = 60): string | null {
	return sanitizeLabel(raw, maxLen);
}

/**
 * Turn a raw transcription into typed values, dropping everything that doesn't
 * survive the app's own parsers.
 *
 * A null `raw` — the model was off, unreachable, or answered with prose — is not
 * a special case: it produces the same empty result as a model that answered
 * with nonsense, which is the property that keeps the caller's code honest.
 */
export function coerceFields<const S extends readonly FieldSpec[]>(
	raw: Record<string, string> | null | undefined,
	spec: S,
	opts: CoerceOptions
): Coerced<S> {
	const out: Record<string, unknown> = {};
	if (!raw) return out as Coerced<S>;

	for (const field of spec) {
		const value = raw[field.key];
		if (typeof value !== 'string') continue;

		const coerced =
			field.kind === 'money'
				? coerceMoney(value, opts.currency)
				: field.kind === 'date'
					? coerceDate(value, opts.dayFirst)
					: coerceText(value);

		if (coerced !== null) out[field.key] = coerced;
	}

	return out as Coerced<S>;
}

/**
 * `coerceFields` over a list of rows. A row that loses *every* field is dropped
 * — it carried nothing the app could use, and an empty row in a statement import
 * is worse than a missing one because it looks like a transaction.
 */
export function coerceRows<const S extends readonly FieldSpec[]>(
	raw: Record<string, string>[] | null | undefined,
	spec: S,
	opts: CoerceOptions
): Coerced<S>[] {
	if (!raw) return [];
	return raw
		.map((row) => coerceFields(row, spec, opts))
		.filter((row) => Object.keys(row).length > 0);
}
