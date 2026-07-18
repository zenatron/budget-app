/**
 * Money value object.
 *
 * Amounts are integer minor units (cents) as bigint, paired with an ISO-4217
 * currency code. Arithmetic across currencies throws. Division uses banker's
 * rounding (round half to even).
 */

export class CurrencyMismatchError extends Error {
	constructor(a: string, b: string) {
		super(`Currency mismatch: ${a} vs ${b}`);
		this.name = 'CurrencyMismatchError';
	}
}

export class InvalidMoneyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidMoneyError';
	}
}

const CURRENCY_RE = /^[A-Z]{3}$/;

/** Number of minor-unit digits for a currency (2 for USD, 0 for JPY, 3 for BHD). */
export function minorUnitDigits(currency: string): number {
	const digits = new Intl.NumberFormat('en', {
		style: 'currency',
		currency
	}).resolvedOptions().maximumFractionDigits;
	return digits ?? 2;
}

export class Money {
	readonly minor: bigint;
	readonly currency: string;

	private constructor(minor: bigint, currency: string) {
		this.minor = minor;
		this.currency = currency;
		Object.freeze(this);
	}

	static of(minor: bigint | number, currency: string): Money {
		if (!CURRENCY_RE.test(currency)) {
			throw new InvalidMoneyError(`Invalid ISO-4217 currency code: ${JSON.stringify(currency)}`);
		}
		if (typeof minor === 'number') {
			if (!Number.isSafeInteger(minor)) {
				throw new InvalidMoneyError(`Amount must be a safe integer of minor units, got ${minor}`);
			}
			minor = BigInt(minor);
		}
		return new Money(minor, currency);
	}

	static zero(currency: string): Money {
		return Money.of(0n, currency);
	}

	/** Parse a decimal string like "12.34" (or "-0.5") into minor units. */
	static fromDecimal(input: string, currency: string): Money {
		const digits = minorUnitDigits(currency);
		const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(input.trim());
		if (!m) throw new InvalidMoneyError(`Cannot parse amount: ${JSON.stringify(input)}`);
		const [, sign, intPart, fracPart = ''] = m;
		if (fracPart.length > digits) {
			throw new InvalidMoneyError(
				`${currency} allows ${digits} decimal place(s), got ${JSON.stringify(input)}`
			);
		}
		const minor = BigInt(intPart + fracPart.padEnd(digits, '0'));
		return Money.of(sign ? -minor : minor, currency);
	}

	private assertSameCurrency(other: Money): void {
		if (this.currency !== other.currency) {
			throw new CurrencyMismatchError(this.currency, other.currency);
		}
	}

	plus(other: Money): Money {
		this.assertSameCurrency(other);
		return new Money(this.minor + other.minor, this.currency);
	}

	minus(other: Money): Money {
		this.assertSameCurrency(other);
		return new Money(this.minor - other.minor, this.currency);
	}

	negate(): Money {
		return new Money(-this.minor, this.currency);
	}

	abs(): Money {
		return this.minor < 0n ? this.negate() : this;
	}

	/** Multiply by an integer factor. */
	times(factor: bigint | number): Money {
		if (typeof factor === 'number') {
			if (!Number.isSafeInteger(factor)) {
				throw new InvalidMoneyError(`Factor must be an integer, got ${factor}`);
			}
			factor = BigInt(factor);
		}
		return new Money(this.minor * factor, this.currency);
	}

	/** Divide by an integer, banker's rounding (round half to even). */
	dividedBy(divisor: bigint | number): Money {
		if (typeof divisor === 'number') {
			if (!Number.isSafeInteger(divisor)) {
				throw new InvalidMoneyError(`Divisor must be an integer, got ${divisor}`);
			}
			divisor = BigInt(divisor);
		}
		if (divisor === 0n) throw new InvalidMoneyError('Division by zero');
		return new Money(divideHalfEven(this.minor, divisor), this.currency);
	}

	/**
	 * Split into `weights.length` parts proportional to weights. Parts sum
	 * exactly to the original amount (largest-remainder distribution).
	 */
	allocate(weights: number[]): Money[] {
		if (weights.length === 0) throw new InvalidMoneyError('allocate needs at least one weight');
		if (weights.some((w) => !Number.isSafeInteger(w) || w < 0)) {
			throw new InvalidMoneyError('Weights must be non-negative integers');
		}
		const total = weights.reduce((a, b) => a + b, 0);
		if (total === 0) throw new InvalidMoneyError('Weights must not all be zero');

		const totalB = BigInt(total);
		const shares: bigint[] = [];
		const remainders: { i: number; r: bigint }[] = [];
		for (let i = 0; i < weights.length; i++) {
			const raw = this.minor * BigInt(weights[i]);
			// Truncate toward negative infinity so remainders are non-negative.
			let q = raw / totalB;
			let r = raw % totalB;
			if (r < 0n) {
				q -= 1n;
				r += totalB;
			}
			shares.push(q);
			remainders.push({ i, r });
		}
		let leftover = this.minor - shares.reduce((a, b) => a + b, 0n);
		remainders.sort((a, b) => (b.r === a.r ? a.i - b.i : b.r > a.r ? 1 : -1));
		for (const { i } of remainders) {
			if (leftover === 0n) break;
			shares[i] += 1n;
			leftover -= 1n;
		}
		return shares.map((s) => new Money(s, this.currency));
	}

	equals(other: Money): boolean {
		return this.currency === other.currency && this.minor === other.minor;
	}

	/** -1, 0, or 1. Throws on currency mismatch. */
	compare(other: Money): -1 | 0 | 1 {
		this.assertSameCurrency(other);
		return this.minor < other.minor ? -1 : this.minor > other.minor ? 1 : 0;
	}

	greaterThan(other: Money): boolean {
		return this.compare(other) > 0;
	}

	lessThan(other: Money): boolean {
		return this.compare(other) < 0;
	}

	get isZero(): boolean {
		return this.minor === 0n;
	}

	get isNegative(): boolean {
		return this.minor < 0n;
	}

	get isPositive(): boolean {
		return this.minor > 0n;
	}

	/** Exact decimal string, e.g. "-12.34". No thousands separators. */
	toDecimalString(): string {
		return formatMinorUnits(this.minor, minorUnitDigits(this.currency));
	}

	/** Locale-aware currency formatting; precise for arbitrarily large amounts. */
	format(locale?: string): string {
		return new Intl.NumberFormat(locale, {
			style: 'currency',
			currency: this.currency
		}).format(this.toDecimalString() as unknown as number);
	}

	toJSON(): { minor: string; currency: string } {
		return { minor: this.minor.toString(), currency: this.currency };
	}
}

/**
 * Convert a bigint amount in minor units to a decimal string.
 *
 * @param minor  The amount in minor units (e.g. cents) as a bigint.
 * @param digits Number of minor-unit digits for the currency (2 for USD, 0 for JPY, etc.).
 * @returns Exact decimal string with no thousands separators, e.g. "-12.34".
 */
export function formatMinorUnits(minor: bigint, digits: number): string {
	const neg = minor < 0n;
	const abs = neg ? -minor : minor;
	const s = abs.toString().padStart(digits + 1, '0');
	const intPart = s.slice(0, s.length - digits);
	const frac = digits > 0 ? '.' + s.slice(s.length - digits) : '';
	return `${neg ? '-' : ''}${intPart}${frac}`;
}

/** bigint division with banker's rounding (round half to even). */
export function divideHalfEven(dividend: bigint, divisor: bigint): bigint {
	if (divisor === 0n) throw new InvalidMoneyError('Division by zero');
	// Work in absolute values, reapply sign at the end.
	const negative = dividend < 0n !== divisor < 0n;
	const a = dividend < 0n ? -dividend : dividend;
	const b = divisor < 0n ? -divisor : divisor;
	let q = a / b;
	const r = a % b;
	const twice = r * 2n;
	if (twice > b || (twice === b && q % 2n === 1n)) q += 1n;
	return negative ? -q : q;
}
