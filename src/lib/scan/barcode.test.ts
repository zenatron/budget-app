import { describe, expect, it } from 'vitest';
import { Confirmer, isValidEanUpc } from './barcode';

describe('isValidEanUpc', () => {
	it('accepts real check digits', () => {
		expect(isValidEanUpc('4006381333931')).toBe(true); // EAN-13
		expect(isValidEanUpc('012000161155')).toBe(true); // UPC-A (Pepsi)
		expect(isValidEanUpc('96385074')).toBe(true); // EAN-8
	});

	it('rejects a transposed or altered digit', () => {
		expect(isValidEanUpc('4006381333932')).toBe(false);
		expect(isValidEanUpc('012000161156')).toBe(false);
	});

	it('rejects anything that is not a barcode-shaped number', () => {
		expect(isValidEanUpc('12345')).toBe(false);
		expect(isValidEanUpc('abcdefghijkl')).toBe(false);
		expect(isValidEanUpc('')).toBe(false);
	});
});

describe('Confirmer', () => {
	it('withholds a value until it repeats', () => {
		const c = new Confirmer(2);
		expect(c.offer('123')).toBeNull();
		expect(c.offer('123')).toBe('123');
	});

	it('restarts the count when the read changes', () => {
		const c = new Confirmer(2);
		expect(c.offer('123')).toBeNull();
		expect(c.offer('999')).toBeNull();
		expect(c.offer('123')).toBeNull();
		expect(c.offer('123')).toBe('123');
	});

	it('forgets everything on reset', () => {
		const c = new Confirmer(2);
		c.offer('123');
		c.reset();
		expect(c.offer('123')).toBeNull();
	});
});
