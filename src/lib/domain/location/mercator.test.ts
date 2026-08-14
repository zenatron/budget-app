import { describe, expect, it } from 'vitest';
import type { Coords } from './coords';
import {
	MAX_ZOOM,
	MIN_ZOOM,
	TILE_SIZE,
	fitBounds,
	latToTileY,
	lngToTileX,
	project,
	screenXY,
	tilesFor,
	unproject,
	viewportBounds
} from './mercator';

const SF: Coords = { lat: 37.775, lng: -122.419 };
const LONDON: Coords = { lat: 51.507, lng: -0.128 };
const SYDNEY: Coords = { lat: -33.869, lng: 151.209 };
const NULL_ISLAND: Coords = { lat: 0, lng: 0 };

describe('project / unproject', () => {
	it('puts Null Island at the centre of the single z0 tile', () => {
		expect(project(NULL_ISLAND, 0)).toEqual({ x: TILE_SIZE / 2, y: TILE_SIZE / 2 });
	});

	it('round-trips across both hemispheres at every zoom we draw', () => {
		for (const c of [SF, LONDON, SYDNEY, NULL_ISLAND, { lat: -60.1, lng: 179.9 }]) {
			for (const z of [1, 5, 10, MAX_ZOOM]) {
				const back = unproject(project(c, z), z);
				expect(back.lat).toBeCloseTo(c.lat, 9);
				expect(back.lng).toBeCloseTo(c.lng, 9);
			}
		}
	});

	it('is continuous, so a pinch does not snap between whole zooms', () => {
		// The projection must answer for 12.37 as readily as for 13, or the map
		// jumps while the fingers are still moving.
		const a = project(SF, 12);
		const b = project(SF, 12.5);
		const c = project(SF, 13);
		expect(b.x).toBeGreaterThan(a.x);
		expect(b.x).toBeLessThan(c.x);
		// Doubling the scale per zoom level, exactly.
		expect(c.x / a.x).toBeCloseTo(2, 9);
	});

	it('increases x eastward and y southward', () => {
		expect(lngToTileX(10, 5)).toBeGreaterThan(lngToTileX(-10, 5));
		expect(latToTileY(-10, 5)).toBeGreaterThan(latToTileY(10, 5));
	});

	it('clamps at the poles instead of returning Infinity', () => {
		expect(Number.isFinite(latToTileY(90, 3))).toBe(true);
		expect(Number.isFinite(latToTileY(-90, 3))).toBe(true);
		// Clamped to the Mercator limit, so it lands on the world's edge rather
		// than running off it. (Float rounding leaves it within ~1e-10 of the
		// edge, which is sub-nanometre on the ground; tilesFor clamps the integer
		// tile index anyway.)
		expect(latToTileY(90, 3)).toBeCloseTo(0, 6);
		expect(latToTileY(-90, 3)).toBeCloseTo(2 ** 3, 6);
	});
});

describe('screenXY', () => {
	it('puts the viewport centre in the middle of the canvas', () => {
		const v = { center: SF, z: 13, width: 390, height: 600 };
		const p = screenXY(SF, v);
		expect(p.x).toBeCloseTo(195, 6);
		expect(p.y).toBeCloseTo(300, 6);
	});

	it('moves a point east to the right of centre', () => {
		const v = { center: SF, z: 13, width: 390, height: 600 };
		expect(screenXY({ lat: SF.lat, lng: SF.lng + 0.01 }, v).x).toBeGreaterThan(195);
	});
});

describe('viewportBounds', () => {
	it('brackets the centre', () => {
		const b = viewportBounds({ center: SF, z: 12, width: 390, height: 600 });
		expect(b.minLat).toBeLessThan(SF.lat);
		expect(b.maxLat).toBeGreaterThan(SF.lat);
		expect(b.minLng).toBeLessThan(SF.lng);
		expect(b.maxLng).toBeGreaterThan(SF.lng);
	});

	it('covers more ground when zoomed out', () => {
		const near = viewportBounds({ center: SF, z: 14, width: 390, height: 600 });
		const far = viewportBounds({ center: SF, z: 8, width: 390, height: 600 });
		expect(far.maxLat - far.minLat).toBeGreaterThan(near.maxLat - near.minLat);
	});
});

describe('tilesFor', () => {
	const phone = { center: SF, z: 13, width: 390, height: 600 };

	it('covers the viewport', () => {
		const tiles = tilesFor(phone);
		// 390x600 over 256px tiles is at most 3 wide by 4 tall.
		expect(tiles.length).toBeGreaterThanOrEqual(6);
		expect(tiles.length).toBeLessThanOrEqual(12);
	});

	it('never asks for a tile index outside the world', () => {
		for (const v of [
			phone,
			{ center: { lat: 84, lng: 179.99 }, z: 6, width: 900, height: 900 },
			{ center: { lat: -84, lng: -179.99 }, z: 3, width: 1200, height: 900 },
			{ center: NULL_ISLAND, z: MIN_ZOOM, width: 1400, height: 900 }
		]) {
			const n = 2 ** Math.round(v.z);
			for (const t of tilesFor(v)) {
				expect(Number.isInteger(t.x)).toBe(true);
				expect(Number.isInteger(t.y)).toBe(true);
				expect(t.x).toBeGreaterThanOrEqual(0);
				expect(t.x).toBeLessThan(n);
				expect(t.y).toBeGreaterThanOrEqual(0);
				expect(t.y).toBeLessThan(n);
			}
		}
	});

	it('keeps drawing across the antimeridian instead of leaving blank paper', () => {
		const tiles = tilesFor({ center: { lat: 0, lng: 179.99 }, z: 4, width: 900, height: 400 });
		const xs = new Set(tiles.map((t) => t.x));
		// It wrapped: tiles from both the far east and the far west of the world.
		expect(xs.has(0)).toBe(true);
		expect(xs.has(2 ** 4 - 1)).toBe(true);
	});

	it('places tiles on a 256px lattice relative to the viewport', () => {
		const tiles = tilesFor(phone);
		const first = tiles[0];
		for (const t of tiles) {
			expect((t.px - first.px) % TILE_SIZE).toBeCloseTo(0, 6);
			expect((t.py - first.py) % TILE_SIZE).toBeCloseTo(0, 6);
		}
	});

	it('requests integer zooms even mid-pinch', () => {
		// A fresh tile request per animation frame would be hundreds of requests
		// for one gesture, against somebody else's tile server.
		for (const t of tilesFor({ ...phone, z: 12.37 })) {
			expect(Number.isInteger(t.z)).toBe(true);
			expect(t.z).toBe(12);
		}
	});

	it('scales the nearest level to cover a fractional zoom', () => {
		// At a whole zoom the tile is drawn at its native size.
		for (const t of tilesFor({ ...phone, z: 13 })) {
			expect(t.size).toBeCloseTo(TILE_SIZE, 6);
		}
		// Past a whole zoom, the level below it is stretched…
		for (const t of tilesFor({ ...phone, z: 12.4 })) {
			expect(t.z).toBe(12);
			expect(t.size).toBeCloseTo(TILE_SIZE * 2 ** 0.4, 6);
			expect(t.size).toBeGreaterThan(TILE_SIZE);
		}
		// …and short of one, the level above it is shrunk.
		for (const t of tilesFor({ ...phone, z: 12.6 })) {
			expect(t.z).toBe(13);
			expect(t.size).toBeCloseTo(TILE_SIZE * 2 ** -0.4, 6);
			expect(t.size).toBeLessThan(TILE_SIZE);
		}
	});

	it('still covers the viewport at a fractional zoom', () => {
		for (const z of [12.1, 12.5, 12.9]) {
			const tiles = tilesFor({ ...phone, z });
			const right = Math.max(...tiles.map((t) => t.px + t.size));
			const bottom = Math.max(...tiles.map((t) => t.py + t.size));
			expect(Math.min(...tiles.map((t) => t.px))).toBeLessThanOrEqual(0);
			expect(Math.min(...tiles.map((t) => t.py))).toBeLessThanOrEqual(0);
			expect(right).toBeGreaterThanOrEqual(phone.width);
			expect(bottom).toBeGreaterThanOrEqual(phone.height);
		}
	});
});

describe('fitBounds', () => {
	it('gives a single point the closest zoom the data justifies', () => {
		expect(fitBounds([SF], 390, 600, 48)).toMatchObject({ z: MAX_ZOOM });
	});

	it('zooms out far enough to hold two distant points', () => {
		const { center, z } = fitBounds([SF, SYDNEY], 390, 600, 48);
		const b = viewportBounds({ center, z, width: 390, height: 600 });
		for (const p of [SF, SYDNEY]) {
			expect(p.lat).toBeGreaterThanOrEqual(b.minLat);
			expect(p.lat).toBeLessThanOrEqual(b.maxLat);
		}
	});

	it('picks a neighbourhood zoom for points a few km apart', () => {
		const a: Coords = { lat: 37.775, lng: -122.419 };
		const b: Coords = { lat: 37.805, lng: -122.419 };
		const { z } = fitBounds([a, b], 390, 600, 48);
		expect(z).toBeGreaterThanOrEqual(11);
		expect(z).toBeLessThanOrEqual(14);
	});

	it('never exceeds the honesty cap', () => {
		expect(fitBounds([SF, { lat: 37.7751, lng: -122.4191 }], 390, 600, 48).z).toBeLessThanOrEqual(
			MAX_ZOOM
		);
	});

	it('survives an empty list', () => {
		expect(fitBounds([], 390, 600, 48)).toEqual({ center: { lat: 0, lng: 0 }, z: MIN_ZOOM });
	});
});
