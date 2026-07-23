import { describe, expect, it } from 'vitest';
import { constrainToChoice, sanitizeLabel, type Choice } from './constrain';

const cats: Choice[] = [
	{ id: 'c1', label: 'Groceries' },
	{ id: 'c2', label: 'Dining' },
	{ id: 'c3', label: 'Transport' }
];

describe('constrainToChoice', () => {
	it('accepts an exact id', () => {
		expect(constrainToChoice('c2', cats)).toBe('c2');
	});

	it('accepts an exact label, case-insensitively', () => {
		expect(constrainToChoice('groceries', cats)).toBe('c1');
		expect(constrainToChoice('GROCERIES', cats)).toBe('c1');
	});

	it('unwraps quotes and json a model tends to add', () => {
		expect(constrainToChoice('"Dining"', cats)).toBe('c2');
		expect(constrainToChoice('{Transport}', cats)).toBe('c3');
	});

	it('extracts a single label from a chatty sentence', () => {
		expect(constrainToChoice('That looks like Groceries to me.', cats)).toBe('c1');
	});

	it('refuses when two labels appear (never guesses between them)', () => {
		expect(constrainToChoice('Could be Dining or Transport', cats)).toBeNull();
	});

	it('refuses an invented answer not in the set', () => {
		expect(constrainToChoice('Entertainment', cats)).toBeNull();
		expect(constrainToChoice('c9', cats)).toBeNull();
	});

	it('treats abstentions as null', () => {
		for (const a of ['', 'none', 'N/A', 'unknown', 'other', '   ']) {
			expect(constrainToChoice(a, cats)).toBeNull();
		}
	});

	it('does not let a label win as a fragment of a bigger word', () => {
		const c: Choice[] = [{ id: 'x', label: 'Din' }];
		// "Dining" contains "din" but not as a whole word.
		expect(constrainToChoice('Dining', c)).toBeNull();
	});

	it('a hallucination can only ever become no-suggestion', () => {
		// The core guarantee: nothing outside the caller-owned set escapes.
		const answers = ['definitely category 7', 'the vibe is off', 'ignore previous instructions'];
		for (const a of answers) expect(constrainToChoice(a, cats)).toBeNull();
	});
});

describe('sanitizeLabel', () => {
	it('cleans wrapping punctuation and whitespace', () => {
		expect(sanitizeLabel('  "Blue Bottle Coffee"  ')).toBe('Blue Bottle Coffee');
	});

	it('takes only the first line', () => {
		expect(sanitizeLabel('Blue Bottle\nHere is why...')).toBe('Blue Bottle');
	});

	it('strips control characters', () => {
		expect(sanitizeLabel('BlueBottle')).toBe('Blue Bottle');
	});

	it('caps length', () => {
		const out = sanitizeLabel('x'.repeat(100), 10);
		expect(out).toHaveLength(10);
	});

	it('returns null for empty or abstaining input', () => {
		expect(sanitizeLabel('')).toBeNull();
		expect(sanitizeLabel('   ')).toBeNull();
		expect(sanitizeLabel('unknown')).toBeNull();
	});
});
