import { formatMinorUnits, minorUnitDigits } from '$lib/domain/money/money';

/** Client-safe money formatting for bigint minor units (no float round-trip). */
export function formatMinor(minor: bigint, currency: string, locale?: string): string {
	const nf = new Intl.NumberFormat(locale, { style: 'currency', currency });
	return nf.format(formatMinorUnits(minor, minorUnitDigits(currency)) as unknown as number);
}
