import { describe, expect, it } from 'vitest';
import { extractBill, findAmounts, parseAmount, toLines, type TextItem } from './extract';

/**
 * Layouts are written as a little grid so the tests read like the page they
 * describe. Each row is [x, y, text] at a default size; the helper turns that
 * into positioned items the way a PDF text layer would arrive.
 */
function layout(rows: [number, number, string, number?][], page = 1): TextItem[] {
	return rows.map(([x, y, text, fontSize = 10]) => ({
		text,
		x,
		y,
		width: text.length * fontSize * 0.5,
		height: fontSize,
		fontSize,
		page
	}));
}

describe('parseAmount', () => {
	it('reads plain decimals', () => {
		expect(parseAmount('19.99')).toBe(1999);
		expect(parseAmount('0.50')).toBe(50);
	});

	it('reads anglo grouping', () => {
		expect(parseAmount('1,234.56')).toBe(123456);
		expect(parseAmount('12,345,678.90')).toBe(1234567890);
	});

	it('reads european grouping', () => {
		expect(parseAmount('1.234,56')).toBe(123456);
		expect(parseAmount('1 234,56')).toBe(123456);
	});

	it('treats a lone separator before three digits as grouping', () => {
		expect(parseAmount('1,234')).toBe(123400);
		expect(parseAmount('1.234')).toBe(123400);
	});

	it('treats a lone separator before one or two digits as a decimal point', () => {
		expect(parseAmount('1,5')).toBe(150);
		expect(parseAmount('19,99')).toBe(1999);
	});
});

describe('toLines', () => {
	it('groups items sharing a baseline and orders them left to right', () => {
		const lines = toLines(
			layout([
				[300, 100, '42.00'],
				[50, 100, 'Amount Due'],
				[50, 130, 'Thank you']
			])
		);
		expect(lines).toHaveLength(2);
		expect(lines[0].text).toBe('Amount Due 42.00');
		expect(lines[1].text).toBe('Thank you');
	});

	it('does not weld adjacent runs into one word', () => {
		// PDFs split words constantly; a gap of zero must not become "AmountDue".
		const lines = toLines(
			layout([
				[50, 100, 'Amount'],
				[85, 100, 'Due']
			])
		);
		expect(lines[0].text).toBe('Amount Due');
	});

	it('keeps pages separate', () => {
		const lines = toLines([...layout([[50, 100, 'One']]), ...layout([[50, 100, 'Two']], 2)]);
		expect(lines.map((l) => l.page)).toEqual([1, 2]);
	});
});

describe('findAmounts', () => {
	it('prefers "Amount Due" over a larger subtotal', () => {
		const lines = toLines(
			layout([
				[50, 100, 'Subtotal'],
				[300, 100, '900.00'],
				[50, 120, 'Amount Due'],
				[300, 120, '150.00']
			])
		);
		expect(findAmounts(lines)[0].minor).toBe(15000);
	});

	it('ignores reference numbers', () => {
		const lines = toLines(
			layout([
				[50, 100, 'Account Number 12345678'],
				[50, 120, 'Amount Due'],
				[300, 120, '$42.00']
			])
		);
		const top = findAmounts(lines)[0];
		expect(top.minor).toBe(4200);
	});

	it('reads a label stacked above its figure', () => {
		const lines = toLines(
			layout([
				[50, 100, 'Total Due'],
				[50, 130, '£88.40', 18]
			])
		);
		expect(findAmounts(lines)[0].minor).toBe(8840);
	});
});

describe('extractBill', () => {
	it('reports a scan when there is no text layer', () => {
		const out = extractBill([]);
		expect(out.isScanned).toBe(true);
		expect(out.total).toBeNull();
	});

	it('pulls total, currency, dates and vendor off a typical utility bill', () => {
		const out = extractBill(
			layout([
				[50, 20, 'Northwind Energy', 22],
				[50, 60, '1 Power Lane, Springfield'],
				[50, 140, 'Invoice Date 12 June 2026'],
				[50, 160, 'Due Date 30 June 2026'],
				[50, 200, 'Previous balance'],
				[300, 200, '£120.00'],
				[50, 220, 'Payment received'],
				[300, 220, '£120.00'],
				[50, 240, 'Subtotal'],
				[300, 240, '£72.50'],
				[50, 260, 'VAT'],
				[300, 260, '£7.49'],
				[50, 290, 'Amount Due'],
				[300, 290, '£79.99', 14]
			])
		);

		expect(out.isScanned).toBe(false);
		expect(out.total?.minor).toBe(7999);
		expect(out.total?.currency).toBe('GBP');
		expect(out.dueDate?.date).toBe('2026-06-30');
		expect(out.issueDate?.date).toBe('2026-06-12');
		expect(out.vendor).toBe('Northwind Energy');
	});

	it('offers the other totals as alternates, not stray line items', () => {
		const out = extractBill(
			layout([
				[50, 100, 'Previous balance'],
				[300, 100, '$120.00'],
				[50, 120, 'Standing charge'],
				[300, 120, '$8.30'],
				[50, 140, 'Subtotal'],
				[300, 140, '$72.50'],
				[50, 160, 'Amount Due'],
				[300, 160, '$79.99']
			])
		);
		expect(out.total?.minor).toBe(7999);
		// If the pick is wrong, the correction is another total — so the big
		// figures come first and the £8.30 line item does not crowd them out.
		expect(out.alternates.map((a) => a.minor)).toEqual([12000, 7250, 830]);
	});

	it('offers runners-up as alternates without repeating the winner', () => {
		const out = extractBill(
			layout([
				[50, 100, 'Subtotal'],
				[300, 100, '$72.50'],
				[50, 120, 'Amount Due'],
				[300, 120, '$79.99'],
				[50, 140, 'Amount Due'],
				[300, 140, '$79.99']
			])
		);
		expect(out.total?.minor).toBe(7999);
		expect(out.alternates.map((a) => a.minor)).not.toContain(7999);
	});

	it('resolves an unambiguous numeric date whatever the convention', () => {
		const dayFirst = extractBill(layout([[50, 100, 'Due Date 25/12/2026']]), { dayFirst: true });
		const monthFirst = extractBill(layout([[50, 100, 'Due Date 25/12/2026']]), { dayFirst: false });
		// 25 cannot be a month, so both conventions must land on the same day.
		expect(dayFirst.dueDate?.date).toBe('2026-12-25');
		expect(monthFirst.dueDate?.date).toBe('2026-12-25');
		expect(dayFirst.dueDate?.ambiguous).toBe(false);
	});

	it('flags a genuinely ambiguous date rather than silently choosing', () => {
		const out = extractBill(layout([[50, 100, 'Due Date 03/04/2026']]), { dayFirst: true });
		expect(out.dueDate?.date).toBe('2026-04-03');
		expect(out.dueDate?.ambiguous).toBe(true);
	});

	it('prefers a document title over the letterhead guess', () => {
		const out = extractBill(layout([[50, 20, 'ACME LTD', 22]]), {
			metadataTitle: 'Contoso Water'
		});
		expect(out.vendor).toBe('Contoso Water');
	});
});
