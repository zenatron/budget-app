import { describe, expect, it } from 'vitest';
import { outOfBriefingScope, type BriefingScope } from './briefing-scope';

// August 2026, so the briefing holds August and July.
const scope: BriefingScope = {
	months: [
		{ y: 2026, m: 8 },
		{ y: 2026, m: 7 }
	],
	today: { y: 2026, m: 8 }
};

describe('outOfBriefingScope', () => {
	describe('lets through what the briefing can answer', () => {
		it('allows a comparison across the two months it holds', () => {
			expect(outOfBriefingScope('am I spending more than last month?', scope)).toBeNull();
		});

		it('allows a question with no time reference at all', () => {
			expect(outOfBriefingScope("what's my biggest expense?", scope)).toBeNull();
			expect(outOfBriefingScope('can I afford a new laptop?', scope)).toBeNull();
		});

		it('allows the months it actually holds, named directly', () => {
			expect(outOfBriefingScope('how did July go?', scope)).toBeNull();
			expect(outOfBriefingScope('august so far?', scope)).toBeNull();
		});
	});

	describe('refuses what it demonstrably cannot', () => {
		it('refuses a month outside the window', () => {
			const r = outOfBriefingScope('how much did I spend in March?', scope);
			expect(r?.mention).toBe('march');
			expect(r?.suggest).toBe('analytics');
		});

		// A bare month later than today can only mean last year's.
		it('refuses a month that has not happened yet this year', () => {
			expect(outOfBriefingScope('what about December?', scope)).not.toBeNull();
		});

		it('refuses an explicit past year of a month it otherwise holds', () => {
			const r = outOfBriefingScope('spending in July 2024?', scope);
			expect(r?.mention).toBe('july 2024');
		});

		it('refuses annual windows', () => {
			expect(outOfBriefingScope('how much did I spend last year?', scope)).not.toBeNull();
			expect(outOfBriefingScope('what is my YTD total?', scope)).not.toBeNull();
			expect(outOfBriefingScope('spending in 2024?', scope)).not.toBeNull();
		});

		it('refuses multi-month windows', () => {
			expect(outOfBriefingScope('trend over the last 6 months', scope)).not.toBeNull();
		});

		// The briefing totals whole months, so a day is as unanswerable as a decade.
		it('refuses sub-month windows and points at the Ledger', () => {
			expect(outOfBriefingScope('what did I spend this week?', scope)?.suggest).toBe('ledger');
			expect(outOfBriefingScope('anything yesterday?', scope)?.suggest).toBe('ledger');
		});

		it('refuses the future', () => {
			expect(outOfBriefingScope('what will I spend next month?', scope)).not.toBeNull();
		});
	});

	it('rolls the window across a year boundary', () => {
		const january: BriefingScope = {
			months: [
				{ y: 2026, m: 1 },
				{ y: 2025, m: 12 }
			],
			today: { y: 2026, m: 1 }
		};
		expect(outOfBriefingScope('how did December go?', january)).toBeNull();
		expect(outOfBriefingScope('how did November go?', january)).not.toBeNull();
	});
});
