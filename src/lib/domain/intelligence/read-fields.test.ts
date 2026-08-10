import { describe, it, expect } from 'vitest';
import { coerceFields, coerceRows, coerceMoney, coerceDate, coerceText } from './read-fields';

const USD = { currency: 'USD' };

describe('coerceMoney — glyphs in, money out, or nothing at all', () => {
	it.each([
		['1240.50', 124050n],
		['$1,240.50', 124050n],
		['1.240,50', 124050n],
		['€ 19.99', 1999n],
		['1240', 124000n],
		['12.5', 1250n]
	])('reads %s', (raw, expected) => {
		expect(coerceMoney(raw, 'USD')).toBe(expected);
	});

	it.each([
		// The failures that matter: a model that answers in words, hedges, or
		// garbles must produce nothing rather than a plausible wrong figure.
		['twelve dollars'],
		['about 1240'],
		[''],
		['   '],
		['N/A'],
		['unknown'],
		['-'],
		['see attached'],
		// Garbled separators: nothing sensible to read, so nothing is read.
		['1,2,3.4.5'],
		// A figure buried in prose is not an answer to "what is the total".
		['the total is 42.00'],
		['42.00 (estimated)']
	])('refuses %s', (raw) => {
		expect(coerceMoney(raw, 'USD')).toBeNull();
	});

	it('reads the accountants’ parenthesised negative', () => {
		expect(coerceMoney('(12.34)', 'USD')).toBe(-1234n);
		expect(coerceMoney('-12.34', 'USD')).toBe(-1234n);
	});

	it.each([
		// A real local model, handed a real bill, returned "USD 125.00". All four
		// of these are ordinary on a page, so all four have to read.
		['19.99 USD', 1999n],
		['USD 125.00', 12500n],
		['$1,240.50', 124050n],
		['1240.50 $', 124050n]
	])('reads a currency marker on either side: %s', (raw, expected) => {
		expect(coerceMoney(raw, 'USD')).toBe(expected);
	});

	it('refuses zero, which is far more often a failed read than a real total', () => {
		expect(coerceMoney('0.00', 'USD')).toBeNull();
		expect(coerceMoney('0', 'USD')).toBeNull();
	});

	it('refuses a figure past the sanity bound', () => {
		expect(coerceMoney('9999999', 'USD')).not.toBeNull();
		expect(coerceMoney('10000001', 'USD')).toBeNull();
	});

	it('lets the currency decide the exponent, rather than assuming cents', () => {
		// JPY has no minor unit, so whole yen parse and "cents" are refused
		// outright instead of being silently rounded into existence.
		expect(coerceMoney('1234', 'JPY')).toBe(1234n);
		expect(coerceMoney('12.34', 'JPY')).toBeNull();
	});

	it('refuses a currency code Money would not accept', () => {
		expect(coerceMoney('12.34', 'not-a-currency')).toBeNull();
	});
});

describe('coerceDate', () => {
	it('reads the formats the app already reads', () => {
		expect(coerceDate('2026-03-14')).toBe('2026-03-14');
		expect(coerceDate('14 March 2026')).toBe('2026-03-14');
		expect(coerceDate('March 14, 2026')).toBe('2026-03-14');
	});

	it('honours the workspace’s day/month convention for an ambiguous date', () => {
		expect(coerceDate('03/04/2026', false)).toBe('2026-03-04');
		expect(coerceDate('03/04/2026', true)).toBe('2026-04-03');
	});

	it('returns a calendar day, never an instant — no server timezone leaks in', () => {
		expect(coerceDate('2026-03-14')).toBe('2026-03-14');
	});

	it.each([['next Tuesday'], ['soon'], ['2026-13-45'], [''], ['N/A']])('refuses %s', (raw) => {
		expect(coerceDate(raw)).toBeNull();
	});
});

describe('coerceText', () => {
	it('cleans through the same guard as every other model output', () => {
		expect(coerceText('  "Acme  Utilities"  ')).toBe('Acme Utilities');
	});

	it('refuses an abstention or an empty answer', () => {
		expect(coerceText('NONE')).toBeNull();
		expect(coerceText('   ')).toBeNull();
	});

	it('caps a runaway answer', () => {
		expect(coerceText('x'.repeat(200))!.length).toBe(60);
	});
});

const BILL = [
	{ key: 'total', kind: 'money' },
	{ key: 'vendor', kind: 'text' },
	{ key: 'dueDate', kind: 'date' }
] as const;

describe('coerceFields', () => {
	it('types a clean transcription', () => {
		const out = coerceFields(
			{ total: '$1,240.50', vendor: 'Acme Utilities', dueDate: '2026-03-14' },
			BILL,
			USD
		);

		expect(out).toEqual({
			total: 124050n,
			vendor: 'Acme Utilities',
			dueDate: '2026-03-14'
		});
	});

	it('drops only the fields that failed, keeping the ones that read', () => {
		const out = coerceFields(
			{ total: 'twelve dollars', vendor: 'Acme Utilities', dueDate: 'sometime' },
			BILL,
			USD
		);

		expect(out).toEqual({ vendor: 'Acme Utilities' });
		expect('total' in out).toBe(false);
	});

	it('is empty for a null transcription — the model being absent is not special', () => {
		expect(coerceFields(null, BILL, USD)).toEqual({});
		expect(coerceFields(undefined, BILL, USD)).toEqual({});
	});

	it('ignores keys nobody asked for, and non-string values', () => {
		const raw = {
			total: '10.00',
			// A model that answers with a nested object or a bare number is not
			// honouring the contract; those values are ignored, not salvaged.
			vendor: 42 as unknown as string,
			somethingElse: 'ignored'
		};

		expect(coerceFields(raw, BILL, USD)).toEqual({ total: 1000n });
	});

	it('cannot be talked into a figure by a confident-sounding answer', () => {
		// There is a parseable "500" in there. It is still refused: a model
		// hedging inside the answer field is precisely when trusting its number is
		// least warranted, so the person types it instead.
		expect(coerceFields({ total: 'definitely $500 (approx)' }, BILL, USD)).toEqual({});
	});
});

const ROW = [
	{ key: 'date', kind: 'date' },
	{ key: 'amount', kind: 'money' },
	{ key: 'description', kind: 'text' }
] as const;

describe('coerceRows', () => {
	it('types each row', () => {
		const out = coerceRows(
			[
				{ date: '2026-03-01', amount: '12.50', description: 'COFFEE' },
				{ date: '2026-03-02', amount: '1,000.00', description: 'RENT' }
			],
			ROW,
			USD
		);

		expect(out).toEqual([
			{ date: '2026-03-01', amount: 1250n, description: 'COFFEE' },
			{ date: '2026-03-02', amount: 100000n, description: 'RENT' }
		]);
	});

	it('drops a row that lost everything, rather than importing a blank transaction', () => {
		const out = coerceRows(
			[
				{ date: 'gibberish', amount: 'lots', description: '   ' },
				{ date: '2026-03-02', amount: '10.00', description: 'RENT' }
			],
			ROW,
			USD
		);

		expect(out).toHaveLength(1);
		expect(out[0].description).toBe('RENT');
	});

	it('keeps a partial row, because a person can finish it', () => {
		const out = coerceRows([{ date: 'gibberish', amount: '10.00', description: 'RENT' }], ROW, USD);
		expect(out).toEqual([{ amount: 1000n, description: 'RENT' }]);
	});

	it('is empty for a null transcription', () => {
		expect(coerceRows(null, ROW, USD)).toEqual([]);
	});
});
