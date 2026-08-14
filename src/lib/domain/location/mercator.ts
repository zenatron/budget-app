/**
 * Web Mercator, by hand.
 *
 * The app carries no map library and this is why it doesn't need one: a raster
 * basemap is four functions of arithmetic, and writing them here keeps the map
 * drawing on the same paper, in the same tokens, as every other figure in the
 * app. Tiles and bubbles project through exactly these functions, so a bubble
 * cannot drift relative to the street under it.
 *
 * The tile-free map — the default, with no tile URL configured — uses the same
 * projection to place bubbles on a graticule. The geometry is correct either
 * way; the tiles only add streets.
 */

import { MAX_LAT, type Coords } from './coords';

export const TILE_SIZE = 256;

/**
 * The zoom cap, and it is load-bearing rather than a performance knob.
 *
 * Pins are rounded to three decimals (~110 m). Past z16 that rounding grid
 * becomes visible as a regular lattice of bubbles, which looks like a rendering
 * bug and, worse, invites someone to read a precision out of the map that the
 * data does not have. The map stops where the honesty of the data stops.
 */
export const MAX_ZOOM = 16;
export const MIN_ZOOM = 1;

export interface WorldPoint {
	/** Pixels from the world's left edge at the given zoom. */
	x: number;
	/** Pixels from the world's top edge at the given zoom. */
	y: number;
}

export interface Viewport {
	center: Coords;
	/** May be fractional while a pinch is in flight. */
	z: number;
	width: number;
	height: number;
}

export interface BBox {
	minLat: number;
	minLng: number;
	maxLat: number;
	maxLng: number;
}

export interface TilePlacement {
	z: number;
	x: number;
	y: number;
	/** Where this tile's top-left corner sits in viewport pixels. */
	px: number;
	py: number;
}

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

/** Tiles across the world at a zoom. Fractional z is rounded — tiles are integers. */
function tilesAcross(z: number): number {
	return 2 ** Math.round(z);
}

export function lngToTileX(lng: number, z: number): number {
	return ((lng + 180) / 360) * tilesAcross(z);
}

export function latToTileY(lat: number, z: number): number {
	// Clamped, not wrapped: the projection runs to infinity at the poles, and an
	// Infinity here would silently become a NaN transform on every tile.
	const rad = (clamp(lat, -MAX_LAT, MAX_LAT) * Math.PI) / 180;
	const y = (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2;
	return y * tilesAcross(z);
}

export function tileXToLng(x: number, z: number): number {
	return (x / tilesAcross(z)) * 360 - 180;
}

export function tileYToLat(y: number, z: number): number {
	const n = Math.PI * (1 - (2 * y) / tilesAcross(z));
	return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

export function project(c: Coords, z: number): WorldPoint {
	return { x: lngToTileX(c.lng, z) * TILE_SIZE, y: latToTileY(c.lat, z) * TILE_SIZE };
}

export function unproject(p: WorldPoint, z: number): Coords {
	return { lat: tileYToLat(p.y / TILE_SIZE, z), lng: tileXToLng(p.x / TILE_SIZE, z) };
}

/** The world's pixel coordinate of the viewport's top-left corner. */
function originOf(v: Viewport): WorldPoint {
	const c = project(v.center, v.z);
	return { x: c.x - v.width / 2, y: c.y - v.height / 2 };
}

/** Where a coordinate lands on screen, in pixels from the viewport's top-left. */
export function screenXY(c: Coords, v: Viewport): { x: number; y: number } {
	const o = originOf(v);
	const p = project(c, v.z);
	return { x: p.x - o.x, y: p.y - o.y };
}

export function viewportBounds(v: Viewport): BBox {
	const o = originOf(v);
	const topLeft = unproject(o, v.z);
	const bottomRight = unproject({ x: o.x + v.width, y: o.y + v.height }, v.z);
	return {
		minLat: Math.min(topLeft.lat, bottomRight.lat),
		maxLat: Math.max(topLeft.lat, bottomRight.lat),
		minLng: Math.min(topLeft.lng, bottomRight.lng),
		maxLng: Math.max(topLeft.lng, bottomRight.lng)
	};
}

/**
 * Every tile needed to paint the viewport, with where each one goes.
 *
 * x wraps around the antimeridian — a tile index is modulo the world, so panning
 * past the date line keeps drawing map instead of blank paper. y does not wrap:
 * there is nothing above the north pole, and asking a tile server for y = −1
 * gets a 404 per tile per frame.
 */
export function tilesFor(v: Viewport): TilePlacement[] {
	const z = Math.round(clamp(v.z, MIN_ZOOM, MAX_ZOOM));
	const n = 2 ** z;
	const o = originOf(v);

	const firstX = Math.floor(o.x / TILE_SIZE);
	const lastX = Math.floor((o.x + v.width) / TILE_SIZE);
	const firstY = Math.max(0, Math.floor(o.y / TILE_SIZE));
	const lastY = Math.min(n - 1, Math.floor((o.y + v.height) / TILE_SIZE));

	const out: TilePlacement[] = [];
	for (let ty = firstY; ty <= lastY; ty++) {
		for (let tx = firstX; tx <= lastX; tx++) {
			out.push({
				z,
				x: ((tx % n) + n) % n,
				y: ty,
				px: tx * TILE_SIZE - o.x,
				py: ty * TILE_SIZE - o.y
			});
		}
	}
	return out;
}

/**
 * The view that shows every point with `padPx` of margin.
 *
 * A single point has no extent, so there is no zoom it "fits" at — it gets
 * MAX_ZOOM, which is as close as the data's precision allows anyone to look.
 */
export function fitBounds(
	points: Coords[],
	width: number,
	height: number,
	padPx: number
): { center: Coords; z: number } {
	if (points.length === 0) return { center: { lat: 0, lng: 0 }, z: MIN_ZOOM };

	// Measured in world pixels at z0, where the whole world is one tile, so the
	// zoom that fits is a single log2 rather than a search.
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const p of points) {
		const w = project(p, 0);
		minX = Math.min(minX, w.x);
		maxX = Math.max(maxX, w.x);
		minY = Math.min(minY, w.y);
		maxY = Math.max(maxY, w.y);
	}

	const center = unproject({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, 0);
	const spanX = maxX - minX;
	const spanY = maxY - minY;
	const availW = Math.max(1, width - padPx * 2);
	const availH = Math.max(1, height - padPx * 2);

	const zx = spanX > 0 ? Math.log2(availW / spanX) : Infinity;
	const zy = spanY > 0 ? Math.log2(availH / spanY) : Infinity;
	const z = Math.min(zx, zy);

	return { center, z: clamp(Number.isFinite(z) ? Math.floor(z) : MAX_ZOOM, MIN_ZOOM, MAX_ZOOM) };
}
