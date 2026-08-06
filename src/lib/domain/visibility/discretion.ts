/**
 * Discretion — how much of the Safe to Spend headline a member wants on screen.
 *
 * Not a permission: everyone who can read the ledger can still read the number,
 * this only decides whether it's *legible over your shoulder* on first render.
 * Per member, because sitting in a café is a personal circumstance, not a
 * property of the household's money. See [[seal]] for the real access control.
 *
 *  - `shown`  — the number, as always.
 *  - `masked` — the shape of the number, with the digits hidden until you ask.
 *               Nothing about how much it is survives the mask.
 *  - `off`    — no headline at all; the ledger starts at the entries.
 */
export const DISCRETION_MODES = ['shown', 'masked', 'off'] as const;

export type DiscretionMode = (typeof DISCRETION_MODES)[number];

/** Whitelist for anything crossing a boundary (a POST body, a stored column). */
export function isDiscretionMode(v: unknown): v is DiscretionMode {
	return typeof v === 'string' && (DISCRETION_MODES as readonly string[]).includes(v);
}

/** Anything unrecognised reads as the plain, non-surprising default. */
export function toDiscretionMode(v: unknown): DiscretionMode {
	return isDiscretionMode(v) ? v : 'shown';
}

/** How many bullets stand in for the digits. Fixed — see maskAmount. */
const BULLETS = '••••';

/** Digits, plus whatever a locale puts *between* them: grouping and decimal
 *  separators, including the space-like ones (fr-FR, de-CH, ru-RU). */
const DIGIT_RUN = /\d(?:[\d.,'\u0020\u00a0\u202f\u2009\u2019]*\d)?/gu;

/**
 * Blank the digits out of an already-formatted amount, keeping the currency
 * symbol and sign so the line still reads as money: "$1,234.56" → "$••••".
 *
 * Every run of digits collapses to the *same* number of bullets on purpose. A
 * per-digit mask ("$•,•••.••") would leak the magnitude, which is the one thing
 * someone glancing at your screen would actually take away.
 */
export function maskAmount(formatted: string): string {
	return formatted.replace(DIGIT_RUN, BULLETS);
}
