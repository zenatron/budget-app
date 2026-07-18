/** Client-safe money formatting for bigint minor units (no float round-trip). */
export function formatMinor(minor: bigint, currency: string, locale?: string): string {
	const nf = new Intl.NumberFormat(locale, { style: 'currency', currency });
	const digits = nf.resolvedOptions().maximumFractionDigits ?? 2;
	const neg = minor < 0n;
	const abs = (neg ? -minor : minor).toString().padStart(digits + 1, '0');
	const intPart = abs.slice(0, abs.length - digits);
	const frac = digits > 0 ? '.' + abs.slice(abs.length - digits) : '';
	return nf.format(`${neg ? '-' : ''}${intPart}${frac}` as unknown as number);
}
