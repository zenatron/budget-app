import { describe, expect, it } from 'vitest';
import { HAPTIC_PATTERNS, pickPattern, tapOffsets, THINKING_PERIOD_MS } from './haptics';

/** Even entries are buzz, odd entries are silence. */
const buzzMs = (pattern: number[]) =>
	pattern.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);

describe('haptics', () => {
	it('keeps every pattern gesture-sized — the buzzing stays under 150ms', () => {
		// Measured on the buzz, not on elapsed time: `thinking` spaces three taps
		// across 198ms, and the gaps between them are silence. What must stay
		// small is how long the device is actually running, because that is what
		// separates feedback from a notification.
		for (const pattern of Object.values(HAPTIC_PATTERNS)) {
			expect(buzzMs(pattern)).toBeLessThanOrEqual(150);
		}
	});

	it('never lets a single pulse outlast the gap before the next one', () => {
		// The thinking pulse repeats. If one pass could run longer than its
		// period, the pulses would overlap and the "still working" tap would
		// smear into a continuous buzz.
		const elapsed = HAPTIC_PATTERNS.thinking.reduce((a, b) => a + b, 0);
		expect(elapsed).toBeLessThan(THINKING_PERIOD_MS);
	});

	it('gives each kind its own pattern', () => {
		expect(pickPattern('tick', { enabled: true, supported: true })).toEqual([8]);
		expect(pickPattern('success', { enabled: true, supported: true })).toEqual([15]);
		expect(pickPattern('error', { enabled: true, supported: true })).toEqual([30, 60, 30]);
	});

	it('says nothing when the pref is off, even on a device that can vibrate', () => {
		expect(pickPattern('success', { enabled: false, supported: true })).toBeUndefined();
	});

	it('says nothing where no haptic channel exists, even with the pref on', () => {
		expect(pickPattern('success', { enabled: true, supported: false })).toBeUndefined();
	});
});

/*
 * iOS can only produce a tap with no duration, so a pattern is played there as
 * taps scheduled at each pulse's start. These are the schedules.
 */
describe('tapOffsets', () => {
	it('fires a single-pulse pattern immediately, once', () => {
		expect(tapOffsets([8])).toEqual([0]);
		expect(tapOffsets([15])).toEqual([0]);
	});

	it('skips the silences and lands each pulse at its own start', () => {
		// error is [30 on, 60 off, 30 on]: two taps, 90ms apart.
		expect(tapOffsets(HAPTIC_PATTERNS.error)).toEqual([0, 90]);
		// thinking is three taps at 0, 96, 192.
		expect(tapOffsets(HAPTIC_PATTERNS.thinking)).toEqual([0, 96, 192]);
	});

	it('gives one offset per pulse', () => {
		for (const pattern of Object.values(HAPTIC_PATTERNS)) {
			expect(tapOffsets(pattern)).toHaveLength(Math.ceil(pattern.length / 2));
		}
	});

	it('handles an empty pattern without inventing a tap', () => {
		expect(tapOffsets([])).toEqual([]);
	});
});
