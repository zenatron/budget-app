import { describe, expect, it } from 'vitest';
import { isPlusCodeRefusal, parsePlusCode, type PlusCodeResult } from './plus-code';
import { roundToE3 } from './coords';

/** Unwraps a decode the test asserts should have succeeded. */
function decoded(text: string): PlusCodeResult {
	const out = parsePlusCode(text);
	if (isPlusCodeRefusal(out)) throw new Error(`expected a decode, got "${out}" for ${text}`);
	return out;
}

describe('parsePlusCode', () => {
	it('decodes the specification’s own reference code', () => {
		// 8FVC2222+22 is the canonical worked example: every digit past the fourth
		// is the zero of the alphabet, so it lands on a round degree plus half a
		// box. If the base-20 arithmetic is wrong anywhere, this moves.
		const { coords } = decoded('8FVC2222+22');
		expect(coords.lat).toBeCloseTo(47.0000625, 7);
		expect(coords.lng).toBeCloseTo(8.0000625, 7);
	});

	it('puts a real code on the real place', () => {
		// 849VCWC8+R9 is the Googleplex, which is where this format was invented.
		expect(roundToE3(decoded('849VCWC8+R9').coords)).toEqual({
			latE3: 37422,
			lngE3: -122084
		});
	});

	it('is case-insensitive and tolerates surrounding space', () => {
		expect(decoded('  849vcwc8+r9  ').coords).toEqual(decoded('849VCWC8+R9').coords);
	});

	it('reads the 4x5 refinement grid, not a square one', () => {
		/*
		 * The grid is 5 rows of latitude by 4 columns of longitude, and decoding it
		 * as square is the classic bug. It has to be pinned with a digit in the
		 * grid's *corner*: 'X' is index 19, the last row and last column. A digit
		 * from the middle row decodes to its parent's own centre, so it agrees with
		 * a broken implementation and proves nothing — which is exactly what the
		 * first draft of this test did.
		 */
		const refined = decoded('8FVC2222+22X');
		expect(refined.coords.lat).toBeCloseTo(47.0001125, 9);
		expect(refined.coords.lng).toBeCloseTo(8.000109375, 9);
		expect(refined.approxMetres).toBeLessThan(decoded('8FVC2222+22').approxMetres);
	});

	it('reports the honest size of the box it decoded', () => {
		// Ten digits is about 14 m; eight is about 275 m. The pin is stored at
		// ~110 m either way, so this is what says whether that is a promotion.
		expect(decoded('849VCWC8+R9').approxMetres).toBeLessThan(20);
		expect(decoded('849VCWC8+').approxMetres).toBeGreaterThan(200);
		expect(decoded('849VCWC8+').approxMetres).toBeLessThan(300);
	});

	it('refuses a shortened code instead of guessing a town', () => {
		// The leading digits are missing, so the same code means somewhere
		// different in every region. There is no honest answer without a reference.
		expect(parsePlusCode('QWJP+2X')).toBe('shortened');
		expect(parsePlusCode('CWC8+R9')).toBe('shortened');
	});

	it('refuses a code too coarse to be a pin', () => {
		// Padded down to six digits is a 5.5 km box — worse than the 2 km device
		// fix the field already rejects as a cell tower rather than a shop.
		expect(parsePlusCode('849VCW00+')).toBe('too-coarse');
		expect(parsePlusCode('84000000+')).toBe('too-coarse');
	});

	it('refuses malformed padding rather than reading past it', () => {
		expect(parsePlusCode('849V0C08+')).toBe('not-a-plus-code');
		expect(parsePlusCode('8490VCC8+')).toBe('not-a-plus-code');
	});

	it('leaves everything that is not a Plus Code alone', () => {
		for (const s of [
			'495 Flatbush Ave, Hartford, CT 06106',
			'41.7398, -72.7133',
			'https://maps.google.com/?q=1,2',
			'QWJP+2X Hartford, CT',
			'',
			'+',
			'849VCWC8',
			'849VCWC8+R',
			'AEIOU111+11'
		]) {
			const out = parsePlusCode(s);
			expect(isPlusCodeRefusal(out), `${s} should not decode`).toBe(true);
		}
	});
});
