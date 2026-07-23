import { describe, expect, it } from 'vitest';
import { parsePurchaseText } from './parse-purchase';

describe('parsePurchaseText', () => {
	it('parses a full sentence into fields', () => {
		const r = parsePurchaseText('23 bucks on lunch at chipotle yesterday');
		expect(r.amount).toBe('23');
		expect(r.dateOffsetDays).toBe(-1);
		expect(r.merchantName).toBe('Chipotle');
		expect(r.itemName).toBe('lunch');
		expect(r.intent).toBe('log');
	});

	it('reads a currency symbol and a decimal', () => {
		const r = parsePurchaseText('$4.50 coffee');
		expect(r.amount).toBe('4.50');
		expect(r.itemName).toBe('coffee');
	});

	it('strips leading verbs and prepositions from the item', () => {
		const r = parsePurchaseText('spent 60 on groceries at whole foods');
		expect(r.amount).toBe('60');
		expect(r.merchantName).toBe('Whole Foods');
		expect(r.itemName).toBe('groceries');
	});

	it('detects a request (ask-first) phrasing', () => {
		const r = parsePurchaseText('can I buy a $200 jacket');
		expect(r.intent).toBe('request');
		expect(r.amount).toBe('200');
		expect(r.itemName).toBe('jacket');
	});

	it('does not mistake a date number for the amount', () => {
		const r = parsePurchaseText('lunch 3 days ago for $12');
		expect(r.amount).toBe('12');
		expect(r.dateOffsetDays).toBe(-3);
		expect(r.itemName).toBe('lunch');
	});

	it('handles "dollars" as a money word', () => {
		const r = parsePurchaseText('bought a book for 15 dollars');
		expect(r.amount).toBe('15');
		expect(r.itemName).toBe('book');
	});

	it('strips thousands separators', () => {
		const r = parsePurchaseText('$1,299 for a laptop');
		expect(r.amount).toBe('1299');
		expect(r.itemName).toBe('laptop');
	});

	it('defaults date to today with no date phrase', () => {
		const r = parsePurchaseText('$8 sandwich');
		expect(r.dateOffsetDays).toBe(0);
		expect(r.dateLabel).toBeNull();
	});

	it('returns a null amount when there is no number', () => {
		const r = parsePurchaseText('coffee at blue bottle');
		expect(r.amount).toBeNull();
		expect(r.merchantName).toBe('Blue Bottle');
		expect(r.itemName).toBe('coffee');
	});

	it('reads "weeks ago"', () => {
		const r = parsePurchaseText('$40 haircut 2 weeks ago');
		expect(r.dateOffsetDays).toBe(-14);
		expect(r.amount).toBe('40');
		expect(r.itemName).toBe('haircut');
	});
});
