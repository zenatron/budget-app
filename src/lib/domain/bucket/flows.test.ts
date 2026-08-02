import { describe, expect, it } from 'vitest';
import { bucketFlows, overdraftBy, type BucketTxn } from './flows';

const opening = (entries: Record<string, bigint> = {}) => new Map(Object.entries(entries));

describe('bucketFlows', () => {
	it('counts money moving in as set aside', () => {
		const f = bucketFlows(opening(), [
			{ bucketId: 'a', amountMinor: 40_000n },
			{ bucketId: 'b', amountMinor: 10_000n }
		]);
		expect(f).toEqual({ setAsideMinor: 50_000n, releasedMinor: 0n, overdraftMinor: 0n });
	});

	it('releases a withdrawal the bucket opened with', () => {
		const f = bucketFlows(opening({ a: 50_000n }), [{ bucketId: 'a', amountMinor: -20_000n }]);
		expect(f).toEqual({ setAsideMinor: 0n, releasedMinor: 20_000n, overdraftMinor: 0n });
	});

	it('treats a charge against an empty bucket as overdraft, not savings', () => {
		const f = bucketFlows(opening(), [{ bucketId: 'a', amountMinor: -5_000n }]);
		expect(f).toEqual({ setAsideMinor: 0n, releasedMinor: 0n, overdraftMinor: 5_000n });
	});

	it('splits a withdrawal that only partly clears', () => {
		const f = bucketFlows(opening({ a: 3_000n }), [{ bucketId: 'a', amountMinor: -8_000n }]);
		expect(f).toEqual({ setAsideMinor: 0n, releasedMinor: 3_000n, overdraftMinor: 5_000n });
	});

	it('funds a withdrawal from money set aside earlier in the same window', () => {
		const f = bucketFlows(opening(), [
			{ bucketId: 'a', amountMinor: 10_000n },
			{ bucketId: 'a', amountMinor: -6_000n }
		]);
		expect(f).toEqual({ setAsideMinor: 10_000n, releasedMinor: 6_000n, overdraftMinor: 0n });
	});

	/*
	 * This pair used to read as a £60 overdraft, on the grounds that the money
	 * wasn't there at the instant of the charge. Two problems with that. The
	 * figures then turned on whether a charge beat the monthly accrual by an hour
	 * on the same day, and the reading double-counted: £100 subtracted as savings
	 * plus £60 added to spending, for a household that spent £60.
	 */
	it('lets money arriving later in the window cover an earlier charge', () => {
		const f = bucketFlows(opening(), [
			{ bucketId: 'a', amountMinor: -6_000n },
			{ bucketId: 'a', amountMinor: 10_000n }
		]);
		expect(f).toEqual({ setAsideMinor: 10_000n, releasedMinor: 6_000n, overdraftMinor: 0n });
	});

	it('reads the same whichever order the two arrived in', () => {
		const withdrawFirst = bucketFlows(opening(), [
			{ bucketId: 'a', amountMinor: -6_000n },
			{ bucketId: 'a', amountMinor: 10_000n }
		]);
		const accrueFirst = bucketFlows(opening(), [
			{ bucketId: 'a', amountMinor: 10_000n },
			{ bucketId: 'a', amountMinor: -6_000n }
		]);
		expect(withdrawFirst).toEqual(accrueFirst);
	});

	it('covers only as much of the earlier charge as later money reaches', () => {
		const f = bucketFlows(opening(), [
			{ bucketId: 'a', amountMinor: -6_000n },
			{ bucketId: 'a', amountMinor: 2_000n }
		]);
		expect(f).toEqual({ setAsideMinor: 2_000n, releasedMinor: 2_000n, overdraftMinor: 4_000n });
	});

	// Money still has to arrive. A charge nothing ever covered stays an overdraft.
	it('leaves a charge nothing covered as an overdraft', () => {
		const f = bucketFlows(opening(), [{ bucketId: 'a', amountMinor: -6_000n }]);
		expect(f).toEqual({ setAsideMinor: 0n, releasedMinor: 0n, overdraftMinor: 6_000n });
	});

	// A bucket that arrived overdrawn owes that to an earlier period, so this
	// period's accrual paying it down is not this period releasing anything.
	it('does not credit an accrual against a deficit carried in', () => {
		const f = bucketFlows(opening({ a: -3_000n }), [{ bucketId: 'a', amountMinor: 10_000n }]);
		expect(f).toEqual({ setAsideMinor: 10_000n, releasedMinor: 0n, overdraftMinor: 0n });
	});

	it('covers only the shortfall incurred inside the window', () => {
		// Opens £30 down, spends £20 it hasn't got, then £50 lands.
		const f = bucketFlows(opening({ a: -3_000n }), [
			{ bucketId: 'a', amountMinor: -2_000n },
			{ bucketId: 'a', amountMinor: 5_000n }
		]);
		expect(f).toEqual({ setAsideMinor: 5_000n, releasedMinor: 2_000n, overdraftMinor: 0n });
	});

	// The identity the whole module rests on, across the awkward cases above.
	it('keeps setAside − released − overdraft equal to the change in balance', () => {
		const cases: { opening: Record<string, bigint>; txns: BucketTxn[] }[] = [
			{ opening: {}, txns: [{ bucketId: 'a', amountMinor: -6_000n }] },
			{
				opening: {},
				txns: [
					{ bucketId: 'a', amountMinor: -6_000n },
					{ bucketId: 'a', amountMinor: 10_000n }
				]
			},
			{
				opening: { a: -3_000n },
				txns: [
					{ bucketId: 'a', amountMinor: -2_000n },
					{ bucketId: 'a', amountMinor: 5_000n }
				]
			},
			{
				opening: { a: 1_000n, b: -500n },
				txns: [
					{ bucketId: 'a', amountMinor: -4_000n },
					{ bucketId: 'b', amountMinor: 900n },
					{ bucketId: 'a', amountMinor: 2_500n },
					{ bucketId: 'b', amountMinor: -100n }
				]
			}
		];
		for (const c of cases) {
			const f = bucketFlows(opening(c.opening), c.txns);
			const change = c.txns.reduce((s, t) => s + t.amountMinor, 0n);
			expect(f.setAsideMinor - f.releasedMinor - f.overdraftMinor).toBe(change);
		}
	});

	it('keeps buckets independent — one is not funded by another', () => {
		const f = bucketFlows(opening({ a: 90_000n }), [{ bucketId: 'b', amountMinor: -7_000n }]);
		expect(f).toEqual({ setAsideMinor: 0n, releasedMinor: 0n, overdraftMinor: 7_000n });
	});

	it('funds nothing out of a bucket that opened overdrawn', () => {
		const f = bucketFlows(opening({ a: -4_000n }), [{ bucketId: 'a', amountMinor: -1_000n }]);
		expect(f).toEqual({ setAsideMinor: 0n, releasedMinor: 0n, overdraftMinor: 1_000n });
	});

	it('lets an accrual dig a bucket out before the next charge draws on it', () => {
		const f = bucketFlows(opening({ a: -4_000n }), [
			{ bucketId: 'a', amountMinor: 10_000n },
			{ bucketId: 'a', amountMinor: -9_000n }
		]);
		// Balance is 6_000 when the charge lands, so 3_000 of it is unfunded.
		expect(f).toEqual({ setAsideMinor: 10_000n, releasedMinor: 6_000n, overdraftMinor: 3_000n });
	});

	it('reconciles with the raw signed sum', () => {
		const txns: BucketTxn[] = [
			{ bucketId: 'a', amountMinor: 40_000n },
			{ bucketId: 'a', amountMinor: -15_000n },
			{ bucketId: 'b', amountMinor: -9_500n },
			{ bucketId: 'b', amountMinor: 2_000n },
			{ bucketId: 'a', amountMinor: -50_000n }
		];
		const f = bucketFlows(opening({ a: 5_000n }), txns);
		const net = txns.reduce((a, t) => a + t.amountMinor, 0n);
		expect(f.setAsideMinor - f.releasedMinor - f.overdraftMinor).toBe(net);
	});

	it('is empty for an empty window', () => {
		expect(bucketFlows(opening({ a: 1_000n }), [])).toEqual({
			setAsideMinor: 0n,
			releasedMinor: 0n,
			overdraftMinor: 0n
		});
	});
});

describe('overdraftBy', () => {
	it('is zero when the balance covers the charge', () => {
		expect(overdraftBy(10_000n, 10_000n)).toBe(0n);
		expect(overdraftBy(10_000n, 4_000n)).toBe(0n);
	});

	it('is the shortfall when it does not', () => {
		expect(overdraftBy(4_000n, 10_000n)).toBe(6_000n);
		expect(overdraftBy(0n, 2_500n)).toBe(2_500n);
	});

	it('counts an already-overdrawn balance as nothing available', () => {
		expect(overdraftBy(-3_000n, 2_000n)).toBe(2_000n);
	});

	it('ignores non-positive charges', () => {
		expect(overdraftBy(0n, 0n)).toBe(0n);
		expect(overdraftBy(0n, -500n)).toBe(0n);
	});

	it('agrees with bucketFlows on the same charge', () => {
		const f = bucketFlows(new Map([['a', 4_000n]]), [{ bucketId: 'a', amountMinor: -10_000n }]);
		expect(f.overdraftMinor).toBe(overdraftBy(4_000n, 10_000n));
	});
});
