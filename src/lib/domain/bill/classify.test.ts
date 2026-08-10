import { describe, it, expect } from 'vitest';
import { classifyDocument } from './classify';
import type { MoneyCandidate } from './extract';

const total = (score: number): MoneyCandidate => ({
	minor: 22171,
	currency: 'USD',
	score,
	page: 1,
	context: 'TOTAL AMOUNT DUE $221.71',
	reason: 'matched due label'
});

const input = (statementRows: number, totalScore: number | null) => ({
	bill: { total: totalScore === null ? null : total(totalScore) },
	statementRows
});

describe('classifyDocument — the clear cases', () => {
	it('calls a page with no dated rows a bill', () => {
		expect(classifyDocument(input(0, 100))).toBe('bill');
		// Even with nothing found at all: there is no statement here, and the bill
		// reader is the only thing that can help.
		expect(classifyDocument(input(0, null))).toBe('bill');
	});

	it('calls a page full of dated rows a statement', () => {
		expect(classifyDocument(input(30, null))).toBe('statement');
	});

	it('still calls it a statement when a summary line looks like a total', () => {
		// A statement's "closing balance" scores like a demand. Thirty dated rows
		// outweigh it — this is the misread that would otherwise prefill a purchase
		// with somebody's account balance.
		expect(classifyDocument(input(30, 100))).toBe('statement');
	});
});

describe('classifyDocument — the small statement that started this', () => {
	it.each([1, 2, 3, 4])('treats %i dated rows with no demand as a statement', (rows) => {
		// A new account's first statement, or a card used twice this month. The row
		// count is low but the shape is unmistakable: dates leading amounts, and
		// nothing on the page asking to be paid.
		expect(classifyDocument(input(rows, null))).toBe('statement');
	});

	it('does not need many rows once nothing claims to be a total', () => {
		expect(classifyDocument(input(1, 20))).toBe('statement');
	});
});

describe('classifyDocument — genuine ambiguity is admitted, not guessed', () => {
	it.each([1, 2, 3, 4])('is ambiguous with %i dated rows and a confident total', (rows) => {
		// Both stories hold: an itemised invoice with dated services, or a short
		// statement whose closing balance reads as a demand. A wrong guess here
		// costs more than a tap, so the caller asks.
		expect(classifyDocument(input(rows, 100))).toBe('ambiguous');
	});

	it('resolves to statement once the rows are decisive', () => {
		expect(classifyDocument(input(5, 100))).toBe('statement');
	});

	it('treats a weakly-scored figure as no demand at all', () => {
		// Below the labelled-total threshold the figure is a guess from position
		// and size, which is not enough to argue with dated rows.
		expect(classifyDocument(input(2, 54))).toBe('statement');
		expect(classifyDocument(input(2, 55))).toBe('ambiguous');
	});
});
