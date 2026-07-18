import { describe, expect, it } from 'vitest';
import {
	CurrencyMismatchError,
	InvalidMoneyError,
	Money,
	divideHalfEven,
	minorUnitDigits
} from './money';

const usd = (n: bigint | number) => Money.of(n, 'USD');

describe('Money.of', () => {
	it('accepts bigint and safe-integer number', () => {
		expect(usd(123n).minor).toBe(123n);
		expect(usd(123).minor).toBe(123n);
		expect(usd(-5).minor).toBe(-5n);
	});

	it('rejects non-integer and unsafe numbers', () => {
		expect(() => usd(1.5)).toThrow(InvalidMoneyError);
		expect(() => usd(Number.MAX_SAFE_INTEGER + 1)).toThrow(InvalidMoneyError);
		expect(() => usd(NaN)).toThrow(InvalidMoneyError);
	});

	it('rejects malformed currency codes', () => {
		expect(() => Money.of(1n, 'usd')).toThrow(InvalidMoneyError);
		expect(() => Money.of(1n, 'US')).toThrow(InvalidMoneyError);
		expect(() => Money.of(1n, '')).toThrow(InvalidMoneyError);
	});

	it('is immutable', () => {
		const m = usd(100);
		expect(Object.isFrozen(m)).toBe(true);
	});
});

describe('arithmetic', () => {
	it('adds and subtracts', () => {
		expect(usd(100).plus(usd(250)).minor).toBe(350n);
		expect(usd(100).minus(usd(250)).minor).toBe(-150n);
	});

	it('rejects cross-currency arithmetic', () => {
		expect(() => usd(1).plus(Money.of(1n, 'EUR'))).toThrow(CurrencyMismatchError);
		expect(() => usd(1).minus(Money.of(1n, 'EUR'))).toThrow(CurrencyMismatchError);
		expect(() => usd(1).compare(Money.of(1n, 'EUR'))).toThrow(CurrencyMismatchError);
	});

	it('negates and abs', () => {
		expect(usd(5).negate().minor).toBe(-5n);
		expect(usd(-5).abs().minor).toBe(5n);
		expect(usd(5).abs().minor).toBe(5n);
	});

	it('multiplies by integers only', () => {
		expect(usd(150).times(3).minor).toBe(450n);
		expect(() => usd(150).times(1.5)).toThrow(InvalidMoneyError);
	});
});

describe("banker's rounding division", () => {
	it('rounds half to even', () => {
		// 5 / 2 = 2.5 → 2 (even); 7 / 2 = 3.5 → 4 (even)
		expect(usd(5).dividedBy(2).minor).toBe(2n);
		expect(usd(7).dividedBy(2).minor).toBe(4n);
		// 15 / 10 = 1.5 → 2; 25 / 10 = 2.5 → 2
		expect(usd(15).dividedBy(10).minor).toBe(2n);
		expect(usd(25).dividedBy(10).minor).toBe(2n);
	});

	it('rounds non-ties to nearest', () => {
		expect(usd(7).dividedBy(3).minor).toBe(2n); // 2.33…
		expect(usd(8).dividedBy(3).minor).toBe(3n); // 2.66…
	});

	it('handles negatives symmetrically', () => {
		expect(usd(-5).dividedBy(2).minor).toBe(-2n);
		expect(usd(-7).dividedBy(2).minor).toBe(-4n);
		expect(usd(5).dividedBy(-2).minor).toBe(-2n);
		expect(usd(-5).dividedBy(-2).minor).toBe(2n);
	});

	it('rejects division by zero', () => {
		expect(() => usd(1).dividedBy(0)).toThrow(InvalidMoneyError);
		expect(() => divideHalfEven(1n, 0n)).toThrow(InvalidMoneyError);
	});
});

describe('allocate', () => {
	it('splits exactly with no lost cents', () => {
		const parts = usd(100).allocate([1, 1, 1]);
		expect(parts.map((p) => p.minor)).toEqual([34n, 33n, 33n]);
		expect(parts.reduce((a, p) => a.plus(p), Money.zero('USD')).minor).toBe(100n);
	});

	it('respects weights', () => {
		const parts = usd(1000).allocate([3, 1]);
		expect(parts.map((p) => p.minor)).toEqual([750n, 250n]);
	});

	it('handles negative totals', () => {
		const parts = usd(-101).allocate([1, 1]);
		expect(parts.reduce((a, p) => a.plus(p), Money.zero('USD')).minor).toBe(-101n);
	});

	it('rejects empty or zero weights', () => {
		expect(() => usd(1).allocate([])).toThrow(InvalidMoneyError);
		expect(() => usd(1).allocate([0, 0])).toThrow(InvalidMoneyError);
		expect(() => usd(1).allocate([-1, 2])).toThrow(InvalidMoneyError);
	});
});

describe('comparisons', () => {
	it('compares', () => {
		expect(usd(1).lessThan(usd(2))).toBe(true);
		expect(usd(2).greaterThan(usd(1))).toBe(true);
		expect(usd(2).equals(usd(2))).toBe(true);
		expect(usd(2).equals(Money.of(2n, 'EUR'))).toBe(false);
		expect(usd(0).isZero).toBe(true);
		expect(usd(-1).isNegative).toBe(true);
		expect(usd(1).isPositive).toBe(true);
	});
});

describe('decimal parsing and formatting', () => {
	it('knows minor unit digits', () => {
		expect(minorUnitDigits('USD')).toBe(2);
		expect(minorUnitDigits('JPY')).toBe(0);
		expect(minorUnitDigits('BHD')).toBe(3);
	});

	it('parses decimal strings', () => {
		expect(Money.fromDecimal('12.34', 'USD').minor).toBe(1234n);
		expect(Money.fromDecimal('12', 'USD').minor).toBe(1200n);
		expect(Money.fromDecimal('12.3', 'USD').minor).toBe(1230n);
		expect(Money.fromDecimal('-0.05', 'USD').minor).toBe(-5n);
		expect(Money.fromDecimal('500', 'JPY').minor).toBe(500n);
	});

	it('rejects excess precision and garbage', () => {
		expect(() => Money.fromDecimal('1.234', 'USD')).toThrow(InvalidMoneyError);
		expect(() => Money.fromDecimal('1.5', 'JPY')).toThrow(InvalidMoneyError);
		expect(() => Money.fromDecimal('12,34', 'USD')).toThrow(InvalidMoneyError);
		expect(() => Money.fromDecimal('$5', 'USD')).toThrow(InvalidMoneyError);
		expect(() => Money.fromDecimal('1e5', 'USD')).toThrow(InvalidMoneyError);
	});

	it('round-trips decimal strings', () => {
		expect(usd(1234).toDecimalString()).toBe('12.34');
		expect(usd(-5).toDecimalString()).toBe('-0.05');
		expect(usd(0).toDecimalString()).toBe('0.00');
		expect(Money.of(500n, 'JPY').toDecimalString()).toBe('500');
	});

	it('formats beyond Number precision without loss', () => {
		const huge = Money.of(90071992547409915n, 'USD'); // > MAX_SAFE_INTEGER
		expect(huge.toDecimalString()).toBe('900719925474099.15');
		expect(huge.format('en-US')).toContain('900,719,925,474,099.15');
	});

	it('formats with locale', () => {
		expect(usd(180000).format('en-US')).toBe('$1,800.00');
	});

	it('serializes to JSON safely', () => {
		expect(JSON.stringify(usd(1234))).toBe('{"minor":"1234","currency":"USD"}');
	});
});
