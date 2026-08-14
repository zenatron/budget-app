import { describe, expect, it } from 'vitest';
import {
	R_MAX,
	R_MIN,
	bubbleRadius,
	cellKeyAt,
	clusterPoints,
	placeLabels,
	type LaidBubble,
	type LocatedAmount
} from './cluster';

let n = 0;
function pt(
	latE3: number,
	lngE3: number,
	amount: number,
	label: string | null = null,
	color: string | null = null
): LocatedAmount {
	return { id: `p${n++}`, latE3, lngE3, amountMinor: BigInt(amount), label, color };
}

// Downtown San Francisco, in millidegrees.
const LAT = 37775;
const LNG = -122419;

describe('cellKeyAt', () => {
	it('is stable for the same point and zoom', () => {
		const c = { lat: 37.775, lng: -122.419 };
		expect(cellKeyAt(c, 12)).toBe(cellKeyAt(c, 12));
	});

	it('carries the zoom, so keys from two zooms never collide', () => {
		const c = { lat: 37.775, lng: -122.419 };
		expect(cellKeyAt(c, 12)).not.toBe(cellKeyAt(c, 13));
		expect(cellKeyAt(c, 12).startsWith('12:')).toBe(true);
	});

	it('rounds a fractional zoom, so a pinch does not re-key every frame', () => {
		const c = { lat: 37.775, lng: -122.419 };
		expect(cellKeyAt(c, 12.4)).toBe(cellKeyAt(c, 12));
	});

	it('does not blow up at the poles', () => {
		expect(cellKeyAt({ lat: 90, lng: 0 }, 8)).toMatch(/^8:\d+:\d+$/);
		expect(cellKeyAt({ lat: -90, lng: 0 }, 8)).toMatch(/^8:\d+:\d+$/);
	});
});

describe('clusterPoints', () => {
	it('returns nothing for nothing', () => {
		expect(clusterPoints([], 12)).toEqual([]);
	});

	it('merges points at the same pin at every zoom', () => {
		const pts = [pt(LAT, LNG, 1000), pt(LAT, LNG, 2500)];
		for (const z of [2, 8, 13, 16]) {
			const [b] = clusterPoints(pts, z);
			expect(clusterPoints(pts, z)).toHaveLength(1);
			expect(b.totalMinor).toBe(3500n);
			expect(b.count).toBe(2);
		}
	});

	it('merges neighbours when zoomed out and splits them when zoomed in', () => {
		// ~5 km apart.
		const pts = [pt(LAT, LNG, 1000), pt(LAT + 45, LNG, 1000)];
		expect(clusterPoints(pts, 6)).toHaveLength(1);
		expect(clusterPoints(pts, 16)).toHaveLength(2);
	});

	it('never has more bubbles zoomed out than zoomed in', () => {
		const pts = [
			pt(LAT, LNG, 100),
			pt(LAT + 3, LNG + 2, 200),
			pt(LAT + 45, LNG - 40, 300),
			pt(LAT + 900, LNG + 1200, 400),
			pt(-33869, 151209, 500)
		];
		let previous = 1;
		for (const z of [2, 4, 6, 8, 10, 12, 14, 16]) {
			const count = clusterPoints(pts, z).length;
			expect(count).toBeGreaterThanOrEqual(previous);
			previous = count;
		}
		expect(previous).toBe(pts.length);
	});

	it('sums money exactly, past what a float would hold', () => {
		const big = 9_007_199_254_740_993n; // 2^53 + 1
		const pts = [
			{ id: 'a', latE3: LAT, lngE3: LNG, amountMinor: big, label: null, color: null },
			{ id: 'b', latE3: LAT, lngE3: LNG, amountMinor: 1n, label: null, color: null }
		];
		expect(clusterPoints(pts, 12)[0].totalMinor).toBe(big + 1n);
	});

	it('centres a bubble on its members, not on the cell', () => {
		const pts = [pt(LAT, LNG, 100), pt(LAT + 2, LNG + 4, 100)];
		const [b] = clusterPoints(pts, 10);
		expect(b.center.lat).toBeCloseTo((LAT + 1) / 1000, 9);
		expect(b.center.lng).toBeCloseTo((LNG + 2) / 1000, 9);
	});

	it('names a bubble after the place with the most money behind it', () => {
		const pts = [
			pt(LAT, LNG, 500, 'Corner Store'),
			pt(LAT, LNG, 300, 'Corner Store'),
			pt(LAT, LNG, 700, 'Costco')
		];
		const [b] = clusterPoints(pts, 12);
		// Costco is the single biggest row, but the Corner Store took more money.
		expect(b.topLabel).toBe('Corner Store');
		expect(b.labelCount).toBe(2);
	});

	it('leaves the label null when nothing inside is named', () => {
		const [b] = clusterPoints([pt(LAT, LNG, 100)], 12);
		expect(b.topLabel).toBeNull();
		expect(b.labelCount).toBe(0);
	});

	it('claims a colour only when one category dominates', () => {
		const mostlyFood = clusterPoints(
			[pt(LAT, LNG, 900, null, 'food'), pt(LAT, LNG, 100, null, 'fuel')],
			12
		);
		expect(mostlyFood[0].color).toBe('food');

		const genuinelyMixed = clusterPoints(
			[pt(LAT, LNG, 500, null, 'food'), pt(LAT, LNG, 500, null, 'fuel')],
			12
		);
		expect(genuinelyMixed[0].color).toBeNull();
	});

	it('reports a bbox that contains every member', () => {
		const pts = [pt(LAT, LNG, 100), pt(LAT + 5, LNG - 7, 100)];
		const [b] = clusterPoints(pts, 8);
		expect(b.bboxE3).toEqual({
			minLatE3: LAT,
			maxLatE3: LAT + 5,
			minLngE3: LNG - 7,
			maxLngE3: LNG
		});
	});

	it('sorts biggest first, and does not depend on row order', () => {
		const small = pt(LAT, LNG, 100);
		const large = pt(LAT + 900, LNG + 900, 5000);
		const forward = clusterPoints([small, large], 14).map((b) => b.key);
		const backward = clusterPoints([large, small], 14).map((b) => b.key);
		expect(forward).toEqual(backward);
		expect(clusterPoints([small, large], 14)[0].totalMinor).toBe(5000n);
	});

	it('carries every member id, so the sheet can look them up', () => {
		const a = pt(LAT, LNG, 100);
		const b = pt(LAT, LNG, 200);
		expect(clusterPoints([a, b], 12)[0].memberIds.sort()).toEqual([a.id, b.id].sort());
	});
});

describe('bubbleRadius', () => {
	it('maps the biggest bubble to the cap and nothing to the floor', () => {
		expect(bubbleRadius(1000n, 1000n)).toBe(R_MAX);
		expect(bubbleRadius(0n, 1000n)).toBe(R_MIN);
	});

	it('makes area, not width, proportional to money', () => {
		// Discounting the R_MIN floor, doubling the money must scale the radius
		// by √2 — otherwise a circle overstates the big numbers wildly.
		const half = bubbleRadius(500n, 1000n) - R_MIN;
		const full = bubbleRadius(1000n, 1000n) - R_MIN;
		expect(full / half).toBeCloseTo(Math.SQRT2, 6);
	});

	it('never divides by zero when the map is empty of money', () => {
		expect(bubbleRadius(0n, 0n)).toBe(R_MIN);
		expect(bubbleRadius(100n, 0n)).toBe(R_MIN);
	});

	it('stays inside the clamp even if a member outgrows the max', () => {
		const r = bubbleRadius(5000n, 1000n);
		expect(r).toBeLessThanOrEqual(R_MAX);
		expect(r).toBeGreaterThanOrEqual(R_MIN);
	});

	it('grows with the amount', () => {
		expect(bubbleRadius(800n, 1000n)).toBeGreaterThan(bubbleRadius(200n, 1000n));
	});
});

describe('placeLabels', () => {
	const lab = (
		key: string,
		x: number,
		y: number,
		r: number,
		amount: number,
		nameText: string | null = null
	): LaidBubble => ({
		key,
		x,
		y,
		r,
		totalMinor: BigInt(amount),
		amountText: '$1,204.00',
		nameText
	});

	it('keeps the bigger label and drops the one that would collide', () => {
		// The big bubble's amount is set inside it, at its centre. The small one's
		// stacks above its own circle, so a centre ~27px lower puts its text right
		// on top — and the bigger amount wins the slot.
		const kept = placeLabels([lab('big', 100, 100, 40, 5000), lab('small', 104, 130, 10, 100)]);
		expect(kept.has('big')).toBe(true);
		expect(kept.has('small')).toBe(false);
	});

	it('keeps labels that are nowhere near each other', () => {
		const kept = placeLabels([lab('a', 40, 40, 20, 5000), lab('b', 300, 400, 20, 100)]);
		expect(kept.size).toBe(2);
	});

	it('gives the same answer whatever order the bubbles arrive in', () => {
		const a = lab('a', 100, 100, 40, 5000);
		const b = lab('b', 106, 130, 10, 100);
		expect([...placeLabels([a, b])]).toEqual([...placeLabels([b, a])]);
	});

	it('labels a lone bubble', () => {
		expect(placeLabels([lab('only', 10, 10, R_MIN, 1)]).has('only')).toBe(true);
	});

	it('reserves the name under a big bubble, not just the amount inside it', () => {
		// The regression this exists to stop: a large bubble's name hangs below
		// its circle, and reserving only the amount let a neighbour's label print
		// straight through it.
		const big = lab('big', 100, 100, 40, 5000, 'Union Square');
		const under = lab('under', 100, 100 + 40 + 8, R_MIN, 100, 'Ferry Building');
		expect(placeLabels([big, under]).has('under')).toBe(false);

		// Far enough below to clear it, and both are kept.
		const clear = lab('clear', 100, 100 + 40 + 60, R_MIN, 100, 'Ferry Building');
		expect(placeLabels([big, clear]).size).toBe(2);
	});

	it('reserves width for the longer of the two lines', () => {
		const short = lab('short', 100, 100, R_MIN, 5000, null);
		// A long name reaches further sideways than the amount does.
		const long = lab('long', 100, 300, R_MIN, 4000, 'A very long place name indeed');
		const near = lab('near', 190, 300, R_MIN, 100, null);
		expect(placeLabels([short, long, near]).has('near')).toBe(false);
	});

	it('handles an empty map', () => {
		expect(placeLabels([]).size).toBe(0);
	});
});
