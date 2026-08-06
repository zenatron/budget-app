import { describe, expect, it } from 'vitest';
import { isDiscretionMode, maskAmount, toDiscretionMode } from './discretion';

describe('isDiscretionMode', () => {
	it('accepts the three modes', () => {
		expect(isDiscretionMode('shown')).toBe(true);
		expect(isDiscretionMode('masked')).toBe(true);
		expect(isDiscretionMode('off')).toBe(true);
	});

	it('rejects anything else', () => {
		for (const v of ['hidden', '', 'SHOWN', null, undefined, 1, {}]) {
			expect(isDiscretionMode(v)).toBe(false);
		}
	});
});

describe('toDiscretionMode', () => {
	it('passes known modes through', () => {
		expect(toDiscretionMode('masked')).toBe('masked');
	});

	it('falls back to shown for stored or posted junk', () => {
		expect(toDiscretionMode('nonsense')).toBe('shown');
		expect(toDiscretionMode(null)).toBe('shown');
	});
});

describe('maskAmount', () => {
	it('hides the digits but keeps the currency and sign', () => {
		expect(maskAmount('$1,234.56')).toBe('$••••');
		expect(maskAmount('−$12.00')).toBe('−$••••');
		expect(maskAmount('+$8.10')).toBe('+$••••');
	});

	it('handles locales that group with spaces or apostrophes', () => {
		expect(maskAmount('1 234,56 €')).toBe('•••• €');
		expect(maskAmount("CHF 1'234.56")).toBe('CHF ••••');
	});

	it('leaks no magnitude: every amount masks to the same width', () => {
		expect(maskAmount('$9.99')).toBe(maskAmount('$9,999,999.99'));
	});

	it('leaves an amount-free string alone', () => {
		expect(maskAmount('Free to spend')).toBe('Free to spend');
	});
});
