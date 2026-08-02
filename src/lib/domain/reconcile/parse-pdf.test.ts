import { describe, expect, it } from 'vitest';
import { extractStatementRows, rowsToCsv } from './parse-pdf';
import { parseCsv } from './parse-csv';
import type { TextItem } from '$lib/domain/bill/extract';

/** Build a text item the way pdf.js reports one. */
function item(text: string, x: number, y: number, page = 1, fontSize = 10): TextItem {
	return { text, x, y, width: text.length * fontSize * 0.5, height: fontSize, fontSize, page };
}

/** A row of a statement: date at the left, amount at the right. */
function row(y: number, date: string, description: string, amount: string, page = 1): TextItem[] {
	return [item(date, 40, y, page), item(description, 110, y, page), item(amount, 480, y, page)];
}

describe('extractStatementRows', () => {
	it('reads a plain statement page', () => {
		const items = [
			item('ACME BANK', 40, 20),
			item('Statement period 1 Mar - 31 Mar', 40, 34),
			...row(80, '03/12/2026', 'SQ *BLUE BOTTLE 8837', '-4.50'),
			...row(96, '03/14/2026', 'AMZN Mktp GB*2H41K', '-32.99'),
			...row(112, '03/15/2026', 'TESCO STORES 3345', '-88.20')
		];

		const { rows, confidence } = extractStatementRows(items);
		expect(confidence).toBe('high');
		expect(rows).toHaveLength(3);
		expect(rows[0]).toMatchObject({
			date: '03/12/2026',
			amount: '-4.50',
			description: 'SQ *BLUE BOTTLE 8837'
		});
		expect(rows[2].amount).toBe('-88.20');
	});

	// Items sharing a baseline arrive in whatever order pdf.js chose; the row is
	// only meaningful once they are back in reading order.
	it('orders a row by x, not by arrival', () => {
		const items = [
			item('-12.00', 480, 80),
			item('CORNER SHOP', 110, 80),
			item('2026-03-02', 40, 80),
			...row(96, '2026-03-03', 'ANOTHER ONE', '-1.00')
		];
		const { rows } = extractStatementRows(items);
		expect(rows[0]).toMatchObject({ date: '2026-03-02', description: 'CORNER SHOP' });
	});

	// Tightly-set statements run about 11-12pt between baselines at 10pt type.
	// The clustering tolerance scales with the document's own type size, so this
	// has to stay two rows rather than collapsing into one unreadable line.
	it('separates rows that are set close together', () => {
		const items = [
			...row(80, '03/01/2026', 'ONE', '-1.00'),
			...row(91, '03/02/2026', 'TWO', '-2.00')
		];
		const { rows } = extractStatementRows(items);
		expect(rows.map((r) => r.description)).toEqual(['ONE', 'TWO']);
	});

	// The other side of the same coin: items on one baseline whose y wobbles by a
	// fraction of a point — different fonts in one row — must stay one row.
	it('keeps a row together when baselines wobble slightly', () => {
		const items = [
			item('03/01/2026', 40, 80),
			item('MIXED FONT SHOP', 110, 80.4),
			item('-1.00', 480, 79.7)
		];
		const { rows } = extractStatementRows(items);
		expect(rows).toHaveLength(1);
		expect(rows[0].description).toBe('MIXED FONT SHOP');
	});

	it('keeps rows from separate pages apart even at the same y', () => {
		const items = [
			...row(80, '03/01/2026', 'PAGE ONE', '-1.00', 1),
			...row(80, '03/02/2026', 'PAGE TWO', '-2.00', 2)
		];
		const { rows } = extractStatementRows(items);
		expect(rows).toHaveLength(2);
		expect(rows[1]).toMatchObject({ description: 'PAGE TWO', page: 2 });
	});

	it('skips headers, totals and balance furniture', () => {
		const items = [
			item('Page 2 of 4', 40, 20),
			item('Opening balance', 40, 40),
			item('1,204.55', 480, 40),
			item('Closing balance', 40, 300),
			item('980.10', 480, 300),
			...row(80, '03/12/2026', 'REAL PURCHASE', '-4.50')
		];
		const { rows } = extractStatementRows(items);
		expect(rows).toHaveLength(1);
		expect(rows[0].description).toBe('REAL PURCHASE');
	});

	it('ignores a row with no date', () => {
		const items = [
			item('Cardholder: A PERSON', 40, 40),
			item('4.50', 480, 40),
			...row(80, '03/12/2026', 'REAL', '-4.50')
		];
		expect(extractStatementRows(items).rows).toHaveLength(1);
	});

	// A bare integer is a reference number far more often than it is money.
	it('does not read a bare integer as an amount', () => {
		const items = [item('03/12/2026', 40, 80), item('REF', 110, 80), item('88371', 480, 80)];
		expect(extractStatementRows(items).rows).toHaveLength(0);
	});

	it('reads a date split across two text runs', () => {
		const items = [
			item('12', 40, 80),
			item('March', 62, 80),
			item('COFFEE', 110, 80),
			item('-3.20', 480, 80)
		];
		const { rows } = extractStatementRows(items);
		expect(rows[0]).toMatchObject({ date: '12 March', description: 'COFFEE' });
	});

	it('takes the rightmost amount when a running balance follows it', () => {
		const items = [
			item('03/12/2026', 40, 80),
			item('SHOP', 110, 80),
			item('-4.50', 400, 80),
			item('1,200.05', 500, 80)
		];
		// Documented behaviour: the balance wins, and is visibly wrong on review
		// rather than plausibly wrong.
		expect(extractStatementRows(items).rows[0].amount).toBe('1,200.05');
	});

	it('reports low confidence when almost nothing parsed', () => {
		const items = [
			...Array.from({ length: 40 }, (_, i) => item(`prose line ${i}`, 40, 20 + i * 14)),
			...row(700, '03/12/2026', 'ONE THING', '-4.50')
		];
		expect(extractStatementRows(items).confidence).toBe('low');
	});

	it('reports low confidence on an empty document', () => {
		const { rows, confidence } = extractStatementRows([]);
		expect(rows).toHaveLength(0);
		expect(confidence).toBe('low');
	});
});

describe('rowsToCsv', () => {
	it('round-trips through the CSV parser the whole pipeline already uses', () => {
		const items = [
			...row(80, '03/12/2026', 'SQ *BLUE BOTTLE 8837', '-4.50'),
			...row(96, '03/14/2026', 'AMZN Mktp GB*2H41K', '-32.99')
		];
		const { rows } = extractStatementRows(items);
		const { lines, errors } = parseCsv(rowsToCsv(rows), 'USD');

		expect(errors).toEqual([]);
		expect(lines).toHaveLength(2);
		expect(lines[0].amountMinor).toBe(-450n);
		expect(lines[0].rawDescription).toBe('SQ *BLUE BOTTLE 8837');
		expect(lines[0].postedAt.toISOString().slice(0, 10)).toBe('2026-03-12');
		expect(lines[1].amountMinor).toBe(-3299n);
	});

	it('escapes a description containing a comma or a quote', () => {
		const csv = rowsToCsv([
			{ date: '03/12/2026', amount: '-4.50', description: 'SHOP, THE "BEST"', page: 1 }
		]);
		const { lines, errors } = parseCsv(csv, 'USD');
		expect(errors).toEqual([]);
		expect(lines[0].rawDescription).toBe('SHOP, THE "BEST"');
	});
});
