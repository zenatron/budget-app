/**
 * Coordinates, and the one place their precision is decided.
 *
 * A pin on a purchase is the most sensitive thing this app stores. It is not
 * money — money is already shared by everyone in the workspace — it is a claim
 * about where a person physically stood, at a time the row also records. So the
 * precision is fixed here, once, at three decimal places (~110 m), and the
 * stored form is an integer count of millidegrees rather than a float: a float
 * column would happily hold seven decimals the moment somebody wrote to it
 * without going through this module, and the privacy decision would be gone
 * with nothing to show it had ever been made.
 *
 * `roundToE3` is called twice on every write — once in the browser, before the
 * reading is ever put in a form field, and once on the server, because a
 * hand-posted form is not obliged to have called the first one.
 *
 * Three decimals is a block, not a doorstep. It is not anonymity: a 110 m
 * circle plus a few hundred timestamped purchases identifies a house. The
 * settings copy says so in plain words.
 */

/** Degrees, as a person or a browser reports them. Never stored in this form. */
export interface Coords {
	lat: number;
	lng: number;
}

/** Millidegrees. The only form that reaches the database. */
export interface CoordsE3 {
	latE3: number;
	lngE3: number;
}

/** Degrees per stored unit. Three decimals — see the note above. */
export const E3 = 1000;

export const MAX_LAT_E3 = 90 * E3;
export const MAX_LNG_E3 = 180 * E3;

/**
 * Web Mercator is undefined at the poles, so every projection clamps latitude
 * to this. Lives here rather than in `mercator` because it is a fact about the
 * coordinate, and `mercator` imports it.
 */
export const MAX_LAT = 85.05112878;

export class LocationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'LocationError';
	}
}

export function isValidCoords(c: Coords): boolean {
	return (
		Number.isFinite(c.lat) &&
		Number.isFinite(c.lng) &&
		c.lat >= -90 &&
		c.lat <= 90 &&
		c.lng >= -180 &&
		c.lng <= 180
	);
}

export function isValidCoordsE3(e: CoordsE3): boolean {
	return (
		Number.isInteger(e.latE3) &&
		Number.isInteger(e.lngE3) &&
		e.latE3 >= -MAX_LAT_E3 &&
		e.latE3 <= MAX_LAT_E3 &&
		e.lngE3 >= -MAX_LNG_E3 &&
		e.lngE3 <= MAX_LNG_E3
	);
}

function clamp(n: number, lo: number, hi: number): number {
	return n < lo ? lo : n > hi ? hi : n;
}

/**
 * Round away from zero, symmetrically. `Math.round` breaks ties toward +∞, so
 * it would round 0.0005 and −0.0005 to different absolute values — a hemisphere
 * deciding how a coordinate rounds is the kind of asymmetry that survives for
 * years because nobody in the northern hemisphere ever sees it.
 */
function roundAwayFromZero(n: number): number {
	return n < 0 ? -Math.round(-n) : Math.round(n);
}

/** Degrees → the stored form. This function is the privacy decision in code. */
export function roundToE3(c: Coords): CoordsE3 {
	if (!isValidCoords(c)) {
		throw new LocationError(`Not a coordinate: ${c.lat}, ${c.lng}`);
	}
	// Clamped after rounding, not before: 179.9996 must land on 180000 rather
	// than overflowing the column, and it must never wrap to −180000, which
	// would move a pin off the coast of New Zealand to the Bering Strait.
	return {
		latE3: clamp(roundAwayFromZero(c.lat * E3), -MAX_LAT_E3, MAX_LAT_E3),
		lngE3: clamp(roundAwayFromZero(c.lng * E3), -MAX_LNG_E3, MAX_LNG_E3)
	};
}

export function fromE3(e: CoordsE3): Coords {
	return { lat: e.latE3 / E3, lng: e.lngE3 / E3 };
}

function part(e3: number): string {
	// U+2212 MINUS SIGN, not the hyphen: these are set in tabular figures beside
	// money, and a hyphen at that size reads as a dash between two numbers.
	const sign = e3 < 0 ? '−' : '';
	const abs = Math.abs(e3);
	// Always three decimals. "37.7" would imply a precision band ten times wider
	// than the one we actually have.
	return `${sign}${Math.floor(abs / E3)}.${String(abs % E3).padStart(3, '0')}`;
}

/** For the detail row and the map sheet: "37.775, −122.419". */
export function formatCoords(e: CoordsE3): string {
	return `${part(e.latE3)}, ${part(e.lngE3)}`;
}

/*
 * A coordinate pair, written out.
 *
 * The fourth honest route to a pin, and the only one that needs nothing at all:
 * no provider, no network, no device permission. Reading it is arithmetic, the
 * same argument that lets a map link resolve offline — which matters most for
 * the deployments that decide a geocoder isn't worth a hundred gigabytes of
 * disk, because it leaves them a way to record an exact spot by hand.
 *
 * Accepts what people actually paste: a comma, a semicolon, a slash or plain
 * whitespace between the two; an optional degree sign; and hemisphere letters
 * instead of a sign. U+2212 is in the sign class because `formatCoords` above
 * emits it — the app renders coordinates with a true minus, so text copied out
 * of this app must be text it can read back in.
 */
const COORD_PAIR =
	/^([+\-−]?\d{1,3}(?:\.\d+)?)\s*°?\s*([NS])?(?:\s*[,;/]\s*|\s+)([+\-−]?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?$/i;

/** One half of the pair: the number, with a hemisphere letter overriding its sign. */
function signedDegrees(text: string, letter: string | undefined, negative: string): number {
	const n = Number(text.replace('−', '-'));
	if (!letter) return n;
	return letter.toUpperCase() === negative ? -Math.abs(n) : Math.abs(n);
}

/**
 * Read "41.7398, −72.7133" — or "41.7398° N, 72.7133° W" — as a coordinate.
 *
 * Returns null for anything else, including a pair that isn't a point on Earth.
 * Deliberately strict about the whole string matching: an address that merely
 * contains two numbers must fall through to the geocoder, not silently become a
 * pin somewhere off the coast of Africa.
 */
export function parseCoordsText(text: string): Coords | null {
	const m = COORD_PAIR.exec(text.trim());
	if (!m) return null;
	const coords = {
		lat: signedDegrees(m[1], m[2], 'S'),
		lng: signedDegrees(m[3], m[4], 'W')
	};
	return isValidCoords(coords) ? coords : null;
}
