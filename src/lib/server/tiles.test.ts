import { describe, expect, it } from 'vitest';
import { MAX_ZOOM } from '$lib/domain/location/mercator';
import { isValidTile } from './tiles';

/*
 * This predicate is the security boundary of the tile proxy. z/x/y are the only
 * parts of the upstream URL that come from a request, and this is what stops
 * the route being a fetch-anything primitive — so it is tested like a boundary
 * rather than like a helper.
 */
describe('isValidTile', () => {
	it('accepts real tiles', () => {
		expect(isValidTile(0, 0, 0)).toBe(true);
		expect(isValidTile(13, 1310, 3166)).toBe(true);
		expect(isValidTile(MAX_ZOOM, 2 ** MAX_ZOOM - 1, 2 ** MAX_ZOOM - 1)).toBe(true);
	});

	it('refuses a zoom past the honesty cap', () => {
		expect(isValidTile(MAX_ZOOM + 1, 0, 0)).toBe(false);
		expect(isValidTile(-1, 0, 0)).toBe(false);
	});

	it('refuses coordinates outside the world at that zoom', () => {
		expect(isValidTile(1, 2, 0)).toBe(false);
		expect(isValidTile(1, 0, 2)).toBe(false);
		expect(isValidTile(1, -1, 0)).toBe(false);
		expect(isValidTile(1, 0, -1)).toBe(false);
	});

	it('refuses anything that is not an integer', () => {
		// The route builds these with Number(), so every one of these is reachable
		// from a hand-written request.
		for (const bad of [NaN, Infinity, -Infinity, 1.5]) {
			expect(isValidTile(bad, 0, 0)).toBe(false);
			expect(isValidTile(2, bad, 0)).toBe(false);
			expect(isValidTile(2, 0, bad)).toBe(false);
		}
	});

	it('refuses values that would escape the template as path or query', () => {
		// Number('../../etc') is NaN and Number('1e999') is Infinity — both are
		// rejected above, but assert it here so the intent is on the record.
		expect(isValidTile(Number('../..'), 0, 0)).toBe(false);
		expect(isValidTile(2, Number('0?x=1'), 0)).toBe(false);
		expect(isValidTile(2, 0, Number('1e999'))).toBe(false);
	});
});
