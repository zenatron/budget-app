import { describe, expect, it } from 'vitest';
import { HAPTIC_PATTERNS, pickPattern } from './haptics';

describe('haptics', () => {
	it('keeps every pattern gesture-sized — the longest buzz stays under 150ms', () => {
		for (const pattern of Object.values(HAPTIC_PATTERNS)) {
			const total = pattern.reduce((a, b) => a + b, 0);
			expect(total).toBeLessThanOrEqual(150);
		}
	});

	it('gives each kind its own pattern', () => {
		expect(pickPattern('tick', { enabled: true, supported: true })).toEqual([8]);
		expect(pickPattern('success', { enabled: true, supported: true })).toEqual([15]);
		expect(pickPattern('error', { enabled: true, supported: true })).toEqual([30, 60, 30]);
	});

	it('says nothing when the pref is off, even on a device that can vibrate', () => {
		expect(pickPattern('success', { enabled: false, supported: true })).toBeUndefined();
	});

	it('says nothing where the Vibration API does not exist, even with the pref on', () => {
		expect(pickPattern('success', { enabled: true, supported: false })).toBeUndefined();
	});
});
