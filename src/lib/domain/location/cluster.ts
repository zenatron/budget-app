/**
 * Turning located purchases into bubbles.
 *
 * Two decisions are worth reading before changing anything here.
 *
 * **The grid is defined in screen pixels, not in degrees.** A cell is the tile
 * grid subdivided by CELL_DIV, so it is always CELL_SIZE_PX across on screen,
 * at every zoom. That single choice is what makes bubbles merge on the way out
 * and split on the way in without any hysteresis, animation bookkeeping, or
 * "cluster radius" tuning: re-run the same function at the new zoom and the
 * answer is already right.
 *
 * **Radius scales with the square root of the amount.** Area is what a person
 * reads off a circle, so area is what has to carry the money — a bubble twice
 * as wide must mean four times the spend. Scaling the radius linearly is the
 * classic bubble-chart lie and it overstates big numbers enormously.
 *
 * Everything is bigint minor units, summed exactly. Floats appear only at the
 * last step, where a radius in pixels is genuinely a float.
 */

import { E3, MAX_LAT, type Coords } from './coords';
import { TILE_SIZE } from './mercator';

/** One located purchase, as the map receives it. */
export interface LocatedAmount {
	id: string;
	latE3: number;
	lngE3: number;
	amountMinor: bigint;
	/** Merchant name, or the typed place label. Null when neither is known. */
	label: string | null;
	/** The category's colour, for the wash. */
	color: string | null;
}

export interface BBoxE3 {
	minLatE3: number;
	minLngE3: number;
	maxLatE3: number;
	maxLngE3: number;
}

export interface Bubble {
	/** Stable across re-renders at the same zoom, so Svelte can key on it. */
	key: string;
	/** The mean of the members, not the cell's centre — see clusterPoints. */
	center: Coords;
	totalMinor: bigint;
	count: number;
	/** What the bubble is called: the label with the most money behind it. */
	topLabel: string | null;
	/** Distinct named places inside, which drives "…and 3 more". */
	labelCount: number;
	/** The dominant category's colour, or null when the bubble is genuinely mixed. */
	color: string | null;
	memberIds: string[];
	bboxE3: BBoxE3;
}

/** Tiles are 256px, so a cell is 64px on screen at every zoom. */
export const CELL_DIV = 4;
export const CELL_SIZE_PX = TILE_SIZE / CELL_DIV;

/** Below this radius a bubble stops clearing the app's touch floor. */
export const R_MIN = 9;
/** Above it, one big month swallows the map. */
export const R_MAX = 46;

/** At or above this radius the amount is set inside the bubble rather than above it. */
export const INSIDE_R = 22;

/**
 * A colour is only claimed when it genuinely dominates. Below this the bubble
 * is drawn neutral: averaging four categories into one tint would state a
 * category the money does not have.
 */
const DOMINANT_SHARE = 0.6;

const cellsAcross = (z: number) => 2 ** Math.round(z) * CELL_DIV;

/** Which grid cell a coordinate falls in at a zoom. */
export function cellKeyAt(c: Coords, z: number): string {
	const n = cellsAcross(z);
	// Clamped into the world, not just the projection. Clamping the latitude to
	// the Mercator limit still leaves float error of ~1e-11, which floors to cell
	// −1 at the pole — an off-world index that would key its own phantom bubble.
	const cx = clampCell(Math.floor(((c.lng + 180) / 360) * n), n);
	const rad = (Math.max(-MAX_LAT, Math.min(MAX_LAT, c.lat)) * Math.PI) / 180;
	const cy = clampCell(
		Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n),
		n
	);
	return `${Math.round(z)}:${cx}:${cy}`;
}

const clampCell = (i: number, n: number) => (i < 0 ? 0 : i > n - 1 ? n - 1 : i);

/**
 * Group located purchases into bubbles for a zoom.
 *
 * The bubble's centre is the mean of its members, never the cell's centre. With
 * the cell's centre a lone shop would sit up to half a cell away from the street
 * it is on, and would visibly jump as the grid changed under it on zoom — the
 * bubble would be pointing at the wrong building, which on a map is simply
 * wrong rather than merely imprecise.
 *
 * Output is sorted biggest-first so the renderer's z-order, the label placer's
 * priority, and the sheet's "top places" all agree without re-sorting.
 */
export function clusterPoints(points: LocatedAmount[], z: number): Bubble[] {
	const cells = new Map<string, LocatedAmount[]>();
	for (const p of points) {
		const key = cellKeyAt({ lat: p.latE3 / E3, lng: p.lngE3 / E3 }, z);
		const bucket = cells.get(key);
		if (bucket) bucket.push(p);
		else cells.set(key, [p]);
	}

	const bubbles: Bubble[] = [];
	for (const [key, members] of cells) {
		let totalMinor = 0n;
		let sumLat = 0;
		let sumLng = 0;
		const byLabel = new Map<string, bigint>();
		const byColor = new Map<string, bigint>();
		const bboxE3: BBoxE3 = {
			minLatE3: Infinity,
			minLngE3: Infinity,
			maxLatE3: -Infinity,
			maxLngE3: -Infinity
		};

		for (const m of members) {
			totalMinor += m.amountMinor;
			sumLat += m.latE3;
			sumLng += m.lngE3;
			bboxE3.minLatE3 = Math.min(bboxE3.minLatE3, m.latE3);
			bboxE3.maxLatE3 = Math.max(bboxE3.maxLatE3, m.latE3);
			bboxE3.minLngE3 = Math.min(bboxE3.minLngE3, m.lngE3);
			bboxE3.maxLngE3 = Math.max(bboxE3.maxLngE3, m.lngE3);
			if (m.label) byLabel.set(m.label, (byLabel.get(m.label) ?? 0n) + m.amountMinor);
			if (m.color) byColor.set(m.color, (byColor.get(m.color) ?? 0n) + m.amountMinor);
		}

		bubbles.push({
			key,
			center: { lat: sumLat / members.length / E3, lng: sumLng / members.length / E3 },
			totalMinor,
			count: members.length,
			topLabel: heaviest(byLabel),
			labelCount: byLabel.size,
			color: dominant(byColor, totalMinor),
			memberIds: members.map((m) => m.id),
			bboxE3
		});
	}

	return bubbles.sort(byAmountThenKey);
}

/** Ties break on the key, so the order never depends on how the rows arrived. */
function byAmountThenKey(a: { totalMinor: bigint; key: string }, b: typeof a): number {
	if (a.totalMinor !== b.totalMinor) return a.totalMinor > b.totalMinor ? -1 : 1;
	return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function heaviest(weights: Map<string, bigint>): string | null {
	let best: string | null = null;
	let bestWeight = -1n;
	// Iterating a Map is insertion-ordered, so ties break on the key to stay
	// independent of row order.
	for (const [k, w] of weights) {
		if (w > bestWeight || (w === bestWeight && best !== null && k < best)) {
			best = k;
			bestWeight = w;
		}
	}
	return best;
}

function dominant(weights: Map<string, bigint>, total: bigint): string | null {
	if (total <= 0n) return null;
	const top = heaviest(weights);
	if (top === null) return null;
	const share = weights.get(top)!;
	// Integer comparison rather than a float ratio: exactness is free here.
	return share * 100n >= total * BigInt(Math.round(DOMINANT_SHARE * 100)) ? top : null;
}

/**
 * Radius in pixels for a bubble, relative to the biggest bubble on screen.
 *
 * Area carries the money (hence the square root). The R_MIN floor breaks strict
 * proportionality at the small end, and that is a deliberate trade: a bubble too
 * small to tap is worse than one very slightly overstated.
 */
export function bubbleRadius(totalMinor: bigint, maxMinor: bigint): number {
	if (maxMinor <= 0n || totalMinor <= 0n) return R_MIN;
	const ratio = Math.min(1, Number(totalMinor) / Number(maxMinor));
	return R_MIN + (R_MAX - R_MIN) * Math.sqrt(ratio);
}

export interface LaidBubble {
	key: string;
	x: number;
	y: number;
	r: number;
	totalMinor: bigint;
	/** The longest line that will be drawn, for the width estimate. */
	text: string;
}

/**
 * Which bubbles get printed text.
 *
 * Bubbles themselves are allowed to overlap — two washes crossing reads as
 * density, which is true and is information. Text overlapping text reads as a
 * bug. So it is greedy by amount: the biggest label is placed first and any
 * later one whose box hits a placed box is simply dropped.
 *
 * The box is computed here, from the same INSIDE_R rule the renderer uses, so
 * the two cannot disagree about where a label sits.
 */
export function placeLabels(laid: LaidBubble[], charW = 6.2, lineH = 13): Set<string> {
	const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
	const keep = new Set<string>();

	for (const b of [...laid].sort(byAmountThenKey)) {
		const w = Math.max(charW * 3, b.text.length * charW);
		// Inside a big bubble: one line, centred. Above a small one: two stacked
		// lines (amount over name) sitting clear of the circle.
		const h = b.r >= INSIDE_R ? lineH : lineH * 2;
		const cy = b.r >= INSIDE_R ? b.y : b.y - b.r - lineH;
		const box = { x0: b.x - w / 2, x1: b.x + w / 2, y0: cy - h / 2, y1: cy + h / 2 };

		const collides = placed.some(
			(p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0
		);
		if (collides) continue;
		placed.push(box);
		keep.add(b.key);
	}

	return keep;
}
