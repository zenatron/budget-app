import { describe, expect, it } from 'vitest';
import { rateLimitOk } from './rate-limit';

// The limiter's Map is module-global, so every test uses a distinct key.
let n = 0;
const key = () => `test-${n++}`;

describe('rateLimitOk', () => {
	it('allows up to the limit, then refuses', () => {
		const k = key();
		for (let i = 0; i < 3; i++) {
			expect(rateLimitOk(k, 3, 1000, 0)).toBe(true);
		}
		expect(rateLimitOk(k, 3, 1000, 0)).toBe(false);
	});

	it('keeps refusing while the window holds, without extending it', () => {
		const k = key();
		rateLimitOk(k, 1, 1000, 0);
		// A rejected attempt must not count as a hit, or a client hammering the
		// endpoint could hold its own window open forever.
		expect(rateLimitOk(k, 1, 1000, 500)).toBe(false);
		expect(rateLimitOk(k, 1, 1000, 999)).toBe(false);
		expect(rateLimitOk(k, 1, 1000, 1001)).toBe(true);
	});

	it('slides rather than resetting in fixed blocks', () => {
		const k = key();
		rateLimitOk(k, 2, 1000, 0);
		rateLimitOk(k, 2, 1000, 900);
		expect(rateLimitOk(k, 2, 1000, 950)).toBe(false);
		// The t=0 hit has aged out but the t=900 one hasn't: room for exactly one.
		expect(rateLimitOk(k, 2, 1000, 1500)).toBe(true);
		expect(rateLimitOk(k, 2, 1000, 1550)).toBe(false);
	});

	it('tracks keys independently', () => {
		const a = key();
		const b = key();
		expect(rateLimitOk(a, 1, 1000, 0)).toBe(true);
		expect(rateLimitOk(a, 1, 1000, 0)).toBe(false);
		expect(rateLimitOk(b, 1, 1000, 0)).toBe(true);
	});

	it('lets a key recover fully once its window has passed', () => {
		const k = key();
		expect(rateLimitOk(k, 2, 60_000, 0)).toBe(true);
		expect(rateLimitOk(k, 2, 60_000, 0)).toBe(true);
		expect(rateLimitOk(k, 2, 60_000, 0)).toBe(false);
		expect(rateLimitOk(k, 2, 60_000, 60_001)).toBe(true);
		expect(rateLimitOk(k, 2, 60_000, 60_001)).toBe(true);
	});
});
