import { describe, expect, it } from 'vitest';
import { MAX_ZOOM } from '$lib/domain/location/mercator';
import { isValidTile, takeSlot } from './tiles';

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

/*
 * The budget that matters is the one on going *upstream*. An earlier version
 * limited the route instead — every request, tiles served straight off local
 * disk included — and twenty seconds of zooming around one already-cached city
 * hit it, throttling requests that cost the tile server nothing.
 */
describe('takeSlot', () => {
	it('allows up to the limit inside the window', () => {
		const times: number[] = [];
		for (let i = 0; i < 5; i++) expect(takeSlot(times, 1000 + i, 5)).toBe(true);
		expect(takeSlot(times, 1005, 5)).toBe(false);
	});

	it('lets the window roll off', () => {
		const times: number[] = [];
		for (let i = 0; i < 3; i++) takeSlot(times, 1000, 3);
		expect(takeSlot(times, 1000, 3)).toBe(false);
		// A minute and a millisecond later the earliest attempts have expired.
		expect(takeSlot(times, 1000 + 60_001, 3)).toBe(true);
	});

	it('drops expired entries rather than growing forever', () => {
		const times: number[] = [];
		for (let i = 0; i < 100; i++) takeSlot(times, i * 1000, 1000);
		// Only the last minute's worth is retained.
		expect(times.length).toBeLessThanOrEqual(61);
	});

	it('refuses everything at a zero budget', () => {
		expect(takeSlot([], 1000, 0)).toBe(false);
	});
});
