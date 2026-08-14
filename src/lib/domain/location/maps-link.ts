/**
 * Coordinates out of a pasted link, offline.
 *
 * A Google or Apple Maps URL already contains the answer. Resolving one must
 * therefore not require a geocoder, a network call, or telling any third party
 * that this household went to that address — which is the whole reason this is
 * a domain module and not a call into the `Geocoder` port. Paste a link, get a
 * pin, nothing leaves the box.
 *
 * The contract is deliberately narrow: this returns a coordinate only when the
 * text unambiguously *contains* one. A place name, a shortened link that would
 * need a redirect followed, a plus code — all null. Null means "ask the
 * geocoder", never "have a guess". The failure mode being avoided is a street
 * number read as a latitude: "1600 Amphitheatre Pkwy" must not become 16.00°N,
 * because a wrong pin is not a wrong guess, it is a false record of where
 * somebody stood.
 */

import { isValidCoords, type Coords } from './coords';

/** Accepts a pair only if both halves are real numbers in range. */
function pair(latText: string | undefined, lngText: string | undefined): Coords | null {
	if (latText === undefined || lngText === undefined) return null;
	const lat = Number(latText);
	const lng = Number(lngText);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
	const c = { lat, lng };
	return isValidCoords(c) ? c : null;
}

/** A signed decimal. The decimal point is required everywhere it can be. */
const D = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;

/**
 * Ordered, and the order is the meaning.
 *
 * `!3d…!4d…` is the *place* Google resolved; `@…` is only where the camera
 * happened to be sitting, which after a pan is not the shop. So the place wins
 * when a URL carries both — which is most of them.
 */
const PATTERNS: RegExp[] = [
	// geo:37.775,-122.419 — the RFC 5870 URI, and the most explicit of the lot.
	new RegExp(String.raw`^geo:(${D}),(${D})`, 'i'),
	// Google: .../data=...!3d37.775!4d-122.419
	new RegExp(String.raw`!3d(${D})!4d(${D})`),
	// OpenStreetMap: ?mlat=37.775&mlon=-122.419
	new RegExp(String.raw`[?&]mlat=(${D})&(?:.*&)?mlon=(${D})`, 'i'),
	// OpenStreetMap: #map=15/37.775/-122.419
	new RegExp(String.raw`#map=\d{1,2}(?:\.\d+)?/(${D})/(${D})`, 'i'),
	// Apple and Google: ?ll= / ?q= / &sll= / &daddr= / &destination=
	new RegExp(
		String.raw`[?&](?:ll|q|sll|saddr|daddr|destination|center)=(${D})(?:,|%2C)(${D})`,
		'i'
	),
	// Google: /@37.775,-122.419,17z
	new RegExp(String.raw`@(${D}),(${D})`)
];

/**
 * A bare pair someone typed or copied out of a coordinates field. Both halves
 * must carry a decimal point: "5, 10" is far more likely to be a flat number
 * and a street number than a spot in the Gulf of Guinea.
 */
const DECIMAL = String.raw`[-+]?\d{1,3}\.\d+`;
const BARE = new RegExp(String.raw`^\s*(${DECIMAL})\s*[,;]\s*(${DECIMAL})\s*$`);

export function parseMapsLink(text: string): Coords | null {
	if (!text) return null;
	const raw = text.trim();
	if (!raw) return null;

	// Percent-decoding first, so an `ll=37.775%2C-122.419` still matches. A
	// malformed escape is not a reason to give up on the rest of the string.
	let s = raw;
	try {
		s = decodeURIComponent(raw);
	} catch {
		/* keep the original */
	}

	for (const re of PATTERNS) {
		const m = re.exec(s);
		const hit = pair(m?.[1], m?.[2]);
		if (hit) return hit;
	}

	// Only for text that is *nothing but* a pair. Attempting this inside a longer
	// string is exactly how "1600 Amphitheatre Pkwy, Mountain View" becomes a
	// coordinate off the coast of Africa.
	const bare = BARE.exec(s);
	return pair(bare?.[1], bare?.[2]);
}
