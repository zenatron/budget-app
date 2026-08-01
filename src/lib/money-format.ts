import { Money, formatMinorUnits, minorUnitDigits } from '$lib/domain/money/money';

/** Client-safe money formatting for bigint minor units (no float round-trip). */
export function formatMinor(minor: bigint, currency: string, locale?: string): string {
	const nf = new Intl.NumberFormat(locale, { style: 'currency', currency });
	return nf.format(formatMinorUnits(minor, minorUnitDigits(currency)) as unknown as number);
}

/**
 * Read a half-typed amount field into minor units, or null if it isn't a number
 * yet. For UI that reacts as you type (a warning, a preview) — the server still
 * parses the submitted string itself, and is the only thing that may reject it.
 */
export function tryParseMinor(input: string, currency: string): bigint | null {
	try {
		return Money.fromDecimal(input, currency).minor;
	} catch {
		return null;
	}
}
