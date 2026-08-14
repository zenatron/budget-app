import { describe, expect, it } from 'vitest';
import {
	isObservedPlace,
	isPlaceSource,
	placeFromColumns,
	placeToColumns,
	samePlace,
	shortenPlaceLabel,
	type PurchasePlace
} from './place';

const SF: PurchasePlace = {
	latE3: 37775,
	lngE3: -122419,
	label: 'Ferry Building',
	source: 'device'
};

describe('isPlaceSource', () => {
	it('accepts the four sources and nothing else', () => {
		for (const s of ['device', 'geocode', 'link', 'merchant']) expect(isPlaceSource(s)).toBe(true);
		for (const s of ['gps', '', null, undefined, 7]) expect(isPlaceSource(s)).toBe(false);
	});
});

describe('isObservedPlace', () => {
	it('treats anything the person supplied as observed', () => {
		for (const source of ['device', 'geocode', 'link'] as const) {
			expect(isObservedPlace({ ...SF, source })).toBe(true);
		}
	});

	it('refuses to treat an inherited pin as evidence', () => {
		// Otherwise a vendor's default reinforces itself from purchases that never
		// had a location of their own.
		expect(isObservedPlace({ ...SF, source: 'merchant' })).toBe(false);
	});
});

describe('placeFromColumns', () => {
	it('rebuilds a place', () => {
		expect(
			placeFromColumns({
				latE3: 37775,
				lngE3: -122419,
				placeLabel: 'Ferry Building',
				locationSource: 'device'
			})
		).toEqual(SF);
	});

	it('is null when there is no pin', () => {
		const none = { latE3: null, lngE3: null, placeLabel: null, locationSource: null };
		expect(placeFromColumns(none)).toBeNull();
		expect(placeFromColumns({ ...none, placeLabel: 'Somewhere' })).toBeNull();
	});

	it('refuses a half-written pin rather than putting it on the meridian', () => {
		expect(
			placeFromColumns({ latE3: 37775, lngE3: null, placeLabel: null, locationSource: 'device' })
		).toBeNull();
	});

	it('refuses an out-of-range pin that somehow reached the row', () => {
		expect(
			placeFromColumns({ latE3: 999999, lngE3: 0, placeLabel: null, locationSource: 'device' })
		).toBeNull();
	});

	it('does not overstate where an unlabelled source came from', () => {
		const p = placeFromColumns({
			latE3: 37775,
			lngE3: -122419,
			placeLabel: null,
			locationSource: 'nonsense'
		});
		expect(p?.source).toBe('link');
		expect(isObservedPlace(p!)).toBe(true);
	});
});

describe('placeToColumns', () => {
	it('round-trips a place', () => {
		expect(placeFromColumns(placeToColumns(SF))).toEqual(SF);
	});

	it('clears all four columns together', () => {
		expect(placeToColumns(null)).toEqual({
			latE3: null,
			lngE3: null,
			placeLabel: null,
			locationSource: null
		});
	});
});

describe('samePlace', () => {
	it('is true for the same pin and name', () => {
		expect(samePlace(SF, { ...SF })).toBe(true);
	});

	it('ignores how the pin was arrived at', () => {
		expect(samePlace(SF, { ...SF, source: 'link' })).toBe(true);
	});

	it('is false when the pin or the name moved', () => {
		expect(samePlace(SF, { ...SF, latE3: 37776 })).toBe(false);
		expect(samePlace(SF, { ...SF, label: 'Somewhere else' })).toBe(false);
	});

	it('handles nulls on either side', () => {
		expect(samePlace(null, null)).toBe(true);
		expect(samePlace(SF, null)).toBe(false);
		expect(samePlace(null, SF)).toBe(false);
	});
});

describe('shortenPlaceLabel', () => {
	it('keeps the name and its street, drops the administrative tail', () => {
		expect(
			shortenPlaceLabel(
				'Ferry Building, Harry Bridges Plaza, Financial District, South of Market, San Francisco, California, 94111, United States'
			)
		).toBe('Ferry Building, Harry Bridges Plaza');
	});

	it('steps over a bare house number to reach the street', () => {
		// "San Francisco Ferry Building, 1" names nothing you could find.
		expect(
			shortenPlaceLabel(
				'San Francisco Ferry Building, 1, The Embarcadero, Financial District, San Francisco'
			)
		).toBe('San Francisco Ferry Building, 1, The Embarcadero');
	});

	it('leaves a short label alone', () => {
		expect(shortenPlaceLabel('Golden Gate Park')).toBe('Golden Gate Park');
		expect(shortenPlaceLabel('Castro, San Francisco')).toBe('Castro, San Francisco');
	});

	it('caps anything still too long, with an ellipsis', () => {
		const long = shortenPlaceLabel(`${'A'.repeat(80)}, Somewhere`);
		expect(long.length).toBeLessThanOrEqual(60);
		expect(long.endsWith('…')).toBe(true);
	});

	it('survives labels with no commas or only whitespace', () => {
		expect(shortenPlaceLabel('Somewhere')).toBe('Somewhere');
		expect(shortenPlaceLabel('  ,  ,  ')).toBe(',  ,');
	});
});
