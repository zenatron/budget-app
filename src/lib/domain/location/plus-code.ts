import { isValidCoords, type Coords } from './coords';

/**
 * Plus Codes (Open Location Code), decoded offline.
 *
 * The fifth route to a pin, and the one that most deserves to exist here. A
 * Plus Code is what a maps app offers for somewhere that has no street address
 * — a market stall, a trailhead, a building the postal service has never heard
 * of — which is exactly the case a geocoder is worst at and this app most needs
 * an answer for.
 *
 * It decodes with arithmetic and nothing else: no provider, no network, no
 * imported extract, no dependency. The code *is* the coordinate, written in
 * base 20. That is the same property that lets `maps-link` read a URL offline,
 * and it is why this belongs in the domain rather than behind the geocoder port.
 *
 * Implemented rather than pulled in: the specification is short and fixed, and
 * the decode is the half of it we need. A dependency for eighty lines of base-20
 * arithmetic would be a supply chain for a lookup table.
 */

/** Base-20 digits. Chosen by the spec to avoid vowels, so codes can't spell words. */
const ALPHABET = '23456789CFGHJMPQRVWX';
const SEPARATOR = '+';
/** A full code always has eight digits before the separator. */
const SEPARATOR_POSITION = 8;
const PADDING = '0';

/**
 * Degrees covered by one digit of pair `k`: 20° for the first pair, then a
 * twentieth of that each time. Five pairs land at 0.000125° — about 14 m.
 */
function pairUnit(k: number): number {
	return 20 / 20 ** k;
}

/**
 * The last two digits refine the pair grid, which is 4 columns of longitude by
 * 5 rows of latitude. Not square, and not the same as the pairs — the one part
 * of the format that cannot be guessed from the rest.
 */
const GRID_ROWS = 5;
const GRID_COLS = 4;

export type PlusCodeRefusal = 'not-a-plus-code' | 'shortened' | 'too-coarse';

export interface PlusCodeResult {
	coords: Coords;
	/** The side of the decoded box, in metres — the honest precision of the code. */
	approxMetres: number;
}

/**
 * A shortened code ("QWJP+2X Hartford") carries no absolute position: the
 * leading digits are dropped and recovered from a reference location, so the
 * same short code means different places in different towns. Resolving one
 * would mean geocoding the town first, which is precisely the dependency this
 * module exists to avoid — so it is refused by name instead of guessed at.
 */
function isShortened(code: string): boolean {
	return code.indexOf(SEPARATOR) < SEPARATOR_POSITION;
}

/**
 * The coarsest code worth treating as a pin, in metres.
 *
 * Mirrors the 2 km ceiling `place-field` already puts on a device fix: a code
 * padded down to six digits describes a 5.5 km box, and recording its centre as
 * a 110 m pin would be a confident lie about where somebody stood. Eight digits
 * — the shortest unpadded code — is a 275 m box, which is coarser than storage
 * but honest at the scale of a building.
 */
const MAX_BOX_METRES = 2000;

/** Rough metres per degree of latitude. Only ever used to describe a box's size. */
const METRES_PER_DEGREE = 111_320;

/**
 * Decode a full Plus Code to the centre of the area it names.
 *
 * Returns a refusal rather than throwing, and never guesses: anything that
 * isn't unambiguously a full code comes back as one of the three named reasons,
 * so the caller can say which and offer the way round it.
 */
export function parsePlusCode(text: string): PlusCodeResult | PlusCodeRefusal {
	const code = text.trim().toUpperCase();

	// One separator, and nothing but code around it. A Plus Code pasted with its
	// town attached ("QWJP+2X Hartford") is a shortened code by definition, and
	// is caught below rather than silently trimmed to something else's meaning.
	if (!/^[23456789CFGHJMPQRVWX0]+\+[23456789CFGHJMPQRVWX]*$/.test(code)) {
		return 'not-a-plus-code';
	}
	if (isShortened(code)) return 'shortened';
	if (code.indexOf(SEPARATOR) !== SEPARATOR_POSITION) return 'not-a-plus-code';

	const digits = code.replace(SEPARATOR, '');
	const padIndex = digits.indexOf(PADDING);
	// Padding only ever replaces whole trailing pairs, and only before the
	// separator. "8FVC0022+" is not a coarser code, it is a malformed one.
	if (padIndex !== -1) {
		if (padIndex % 2 !== 0) return 'not-a-plus-code';
		if (!/^0+$/.test(digits.slice(padIndex))) return 'not-a-plus-code';
	}
	const significant = padIndex === -1 ? digits : digits.slice(0, padIndex);
	/*
	 * The first ten digits are read two at a time, so that section must be even —
	 * which is also what rejects a lone digit after the separator. Digits past the
	 * tenth are grid refinements and are read one at a time, so an eleven-digit
	 * code is both odd and perfectly valid. Requiring the whole length to be even
	 * threw those away.
	 */
	if (significant.length < 2) return 'not-a-plus-code';
	if (significant.length < 10 && significant.length % 2 !== 0) return 'not-a-plus-code';
	// The spec stops at fifteen; past that the digits describe nothing further.
	if (significant.length > 15) return 'not-a-plus-code';

	let lat = -90;
	let lng = -180;
	let latBox = 0;
	let lngBox = 0;

	const pairDigits = significant.slice(0, 10);
	for (let i = 0; i < pairDigits.length; i += 2) {
		const unit = pairUnit(i / 2);
		lat += ALPHABET.indexOf(pairDigits[i]) * unit;
		lng += ALPHABET.indexOf(pairDigits[i + 1]) * unit;
		latBox = unit;
		lngBox = unit;
	}

	// Digits past the tenth refine within the last pair's box, on the 4×5 grid.
	for (const d of significant.slice(10)) {
		const i = ALPHABET.indexOf(d);
		latBox /= GRID_ROWS;
		lngBox /= GRID_COLS;
		lat += Math.floor(i / GRID_COLS) * latBox;
		lng += (i % GRID_COLS) * lngBox;
	}

	// The code names a box; a pin needs a point, and the centre is the only
	// choice that doesn't bias every pin south-west.
	const coords = { lat: lat + latBox / 2, lng: lng + lngBox / 2 };
	if (!isValidCoords(coords)) return 'not-a-plus-code';

	const approxMetres = Math.round(latBox * METRES_PER_DEGREE);
	if (approxMetres > MAX_BOX_METRES) return 'too-coarse';

	return { coords, approxMetres };
}

/** Narrowing helper, so callers read as `if (isRefusal(out))`. */
export function isPlusCodeRefusal(out: PlusCodeResult | PlusCodeRefusal): out is PlusCodeRefusal {
	return typeof out === 'string';
}
