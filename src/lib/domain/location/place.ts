/**
 * A place attached to a purchase.
 *
 * Kept as one nested value rather than four loose columns' worth of fields on
 * the aggregate, because the four only ever mean anything together: a latitude
 * without a longitude is not half a place, it is a bug, and the database says
 * so with a check constraint.
 *
 * A place is pure annotation. No transition, no approval policy, and no seal
 * rule reads it — it is carried alongside the state machine, never through it,
 * which is why `edit()` does not touch it and `setPurchasePlace` is allowed in
 * every state including completed.
 */

import { isValidCoordsE3, type CoordsE3 } from './coords';

/**
 * How a pin was arrived at, which decides what it is allowed to do next.
 *
 * - `device`   — the browser's geolocation, on an explicit tap.
 * - `geocode`  — an address the person typed, resolved by the Geocoder port.
 * - `link`     — coordinates read straight out of a pasted map link, offline.
 * - `merchant` — inherited from the vendor's usual place. **Not observed**: the
 *   person did not say they were there, so the map labels it as inherited and
 *   it may never teach another vendor a default.
 */
export type PlaceSource = 'device' | 'geocode' | 'link' | 'merchant';

export const PLACE_SOURCES: readonly PlaceSource[] = ['device', 'geocode', 'link', 'merchant'];

export interface PurchasePlace extends CoordsE3 {
	/** What the place is called, when anything named it. */
	label: string | null;
	source: PlaceSource;
}

export function isPlaceSource(s: unknown): s is PlaceSource {
	return typeof s === 'string' && (PLACE_SOURCES as readonly string[]).includes(s);
}

/**
 * Whether this pin is evidence of someone actually being somewhere.
 *
 * Only an observed pin may become a vendor's saved default. Letting an
 * inherited one write back would launder a guess into a fact: the vendor's
 * default would start reinforcing itself from purchases that never had a
 * location of their own.
 */
export function isObservedPlace(p: PurchasePlace): boolean {
	return p.source !== 'merchant';
}

/** Rebuild a place from four nullable columns, or null if there isn't one. */
export function placeFromColumns(cols: {
	latE3: number | null;
	lngE3: number | null;
	placeLabel: string | null;
	locationSource: string | null;
}): PurchasePlace | null {
	if (cols.latE3 === null || cols.lngE3 === null) return null;
	if (!isValidCoordsE3({ latE3: cols.latE3, lngE3: cols.lngE3 })) return null;
	return {
		latE3: cols.latE3,
		lngE3: cols.lngE3,
		label: cols.placeLabel,
		// A row written before the column existed, or by hand, still has a real
		// pin; calling it 'device' would overstate where it came from.
		source: isPlaceSource(cols.locationSource) ? cols.locationSource : 'link'
	};
}

/** Flatten a place back to the four columns. Null clears all four together. */
export function placeToColumns(place: PurchasePlace | null): {
	latE3: number | null;
	lngE3: number | null;
	placeLabel: string | null;
	locationSource: string | null;
} {
	return {
		latE3: place?.latE3 ?? null,
		lngE3: place?.lngE3 ?? null,
		placeLabel: place?.label ?? null,
		locationSource: place?.source ?? null
	};
}

/** True when two places are the same pin with the same name. */
export function samePlace(a: PurchasePlace | null, b: PurchasePlace | null): boolean {
	if (a === null || b === null) return a === b;
	// `source` is deliberately not compared: re-pinning the same spot by a
	// different route is not a change worth writing an audit event for.
	return a.latE3 === b.latE3 && a.lngE3 === b.lngE3 && a.label === b.label;
}
