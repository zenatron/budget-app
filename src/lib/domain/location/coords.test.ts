import { describe, expect, it } from 'vitest';
import {
	E3,
	LocationError,
	MAX_LAT_E3,
	MAX_LNG_E3,
	formatCoords,
	fromE3,
	isValidCoords,
	isValidCoordsE3,
	parseCoordsText,
	roundToE3
} from './coords';

describe('isValidCoords', () => {
	it('accepts the corners of the world', () => {
		for (const c of [
			{ lat: 0, lng: 0 },
			{ lat: 90, lng: 180 },
			{ lat: -90, lng: -180 }
		]) {
			expect(isValidCoords(c)).toBe(true);
		}
	});

	it('rejects non-finite and out-of-range values', () => {
		for (const c of [
			{ lat: NaN, lng: 0 },
			{ lat: 0, lng: Infinity },
			{ lat: 90.1, lng: 0 },
			{ lat: -90.1, lng: 0 },
			{ lat: 0, lng: 180.1 },
			{ lat: 0, lng: -180.1 }
		]) {
			expect(isValidCoords(c)).toBe(false);
		}
	});
});

describe('roundToE3', () => {
	it('keeps three decimals and discards everything finer', () => {
		expect(roundToE3({ lat: 37.7749295, lng: -122.4194155 })).toEqual({
			latE3: 37775,
			lngE3: -122419
		});
	});

	it('rounds symmetrically across the equator and the meridian', () => {
		// The tie case: Math.round would send these to 123 and -122.
		expect(roundToE3({ lat: 0.1225, lng: -0.1225 })).toEqual({ latE3: 123, lngE3: -123 });
	});

	it('never wraps a coordinate to the far side of the world', () => {
		// 179.9996 rounds up to exactly the bound. Wrapping here would move a pin
		// off New Zealand to the Bering Strait.
		expect(roundToE3({ lat: 89.9996, lng: 179.9996 })).toEqual({
			latE3: MAX_LAT_E3,
			lngE3: MAX_LNG_E3
		});
		expect(roundToE3({ lat: -89.9996, lng: -179.9996 })).toEqual({
			latE3: -MAX_LAT_E3,
			lngE3: -MAX_LNG_E3
		});
	});

	it('throws LocationError rather than storing nonsense', () => {
		expect(() => roundToE3({ lat: NaN, lng: 0 })).toThrow(LocationError);
		expect(() => roundToE3({ lat: 0, lng: 200 })).toThrow(LocationError);
	});

	it('is idempotent through fromE3 — a stored pin never drifts on re-save', () => {
		const once = roundToE3({ lat: 51.5074, lng: -0.1278 });
		expect(roundToE3(fromE3(once))).toEqual(once);
	});

	it('always produces a value the column can hold', () => {
		for (const c of [
			{ lat: 0, lng: 0 },
			{ lat: 90, lng: 180 },
			{ lat: -90, lng: -180 },
			{ lat: 37.7749, lng: -122.4194 }
		]) {
			expect(isValidCoordsE3(roundToE3(c))).toBe(true);
		}
	});
});

describe('fromE3', () => {
	it('inverts roundToE3 for an already-rounded value', () => {
		expect(fromE3({ latE3: 37775, lngE3: -122419 })).toEqual({ lat: 37.775, lng: -122.419 });
	});

	it('agrees with E3', () => {
		expect(fromE3({ latE3: E3, lngE3: -E3 })).toEqual({ lat: 1, lng: -1 });
	});
});

describe('formatCoords', () => {
	it('pads to three decimals rather than implying a wider band', () => {
		expect(formatCoords({ latE3: 37700, lngE3: -122400 })).toBe('37.700, −122.400');
		expect(formatCoords({ latE3: 5, lngE3: -5 })).toBe('0.005, −0.005');
	});

	it('uses a real minus sign, not a hyphen', () => {
		expect(formatCoords({ latE3: -1000, lngE3: 0 })).toContain('−');
		expect(formatCoords({ latE3: -1000, lngE3: 0 })).not.toContain('-');
	});

	it('handles the origin without a stray sign', () => {
		expect(formatCoords({ latE3: 0, lngE3: 0 })).toBe('0.000, 0.000');
	});
});

describe('parseCoordsText', () => {
	it('reads a plain signed pair', () => {
		expect(parseCoordsText('41.7398, -72.7133')).toEqual({ lat: 41.7398, lng: -72.7133 });
	});

	it('reads back what formatCoords wrote', () => {
		// The app renders coordinates with U+2212, so its own output is text a
		// person will copy out of one purchase and paste into another.
		const shown = formatCoords({ latE3: 41740, lngE3: -72713 });
		expect(parseCoordsText(shown)).toEqual({ lat: 41.74, lng: -72.713 });
	});

	it('accepts the separators people actually paste', () => {
		for (const s of ['41.74,-72.713', '41.74 -72.713', '41.74; -72.713', '41.74 / -72.713']) {
			expect(parseCoordsText(s)).toEqual({ lat: 41.74, lng: -72.713 });
		}
	});

	it('accepts hemisphere letters instead of a sign', () => {
		expect(parseCoordsText('41.74° N, 72.713° W')).toEqual({ lat: 41.74, lng: -72.713 });
		expect(parseCoordsText('33.87 S, 151.21 E')).toEqual({ lat: -33.87, lng: 151.21 });
	});

	it('takes the origin, which is a real place', () => {
		expect(parseCoordsText('0, 0')).toEqual({ lat: 0, lng: 0 });
	});

	it('refuses a pair that is not a point on Earth', () => {
		expect(parseCoordsText('91.5, 0')).toBeNull();
		expect(parseCoordsText('0, 181')).toBeNull();
	});

	it('leaves an address for the geocoder rather than guessing a pin', () => {
		// The whole string must be a coordinate. An address that merely contains
		// two numbers becoming a pin is a confident lie about where someone stood.
		for (const s of [
			'495 Flatbush Ave, Hartford, CT 06106',
			'Walmart Supercenter, 495, Flatbush Avenue',
			'06106',
			'',
			'41.7398',
			'lat 41.7398 lng -72.7133'
		]) {
			expect(parseCoordsText(s)).toBeNull();
		}
	});
});
