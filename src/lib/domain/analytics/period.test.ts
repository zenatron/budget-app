import { describe, expect, it } from 'vitest';
import {
	listDays,
	monthLabel,
	monthPeriod,
	previousMonthPeriod,
	previousWeekPeriod,
	weekPeriod
} from './period';

const d = (y: number, m: number, day: number) => ({ y, m, d: day });

describe('month periods', () => {
	it('covers the calendar month', () => {
		expect(monthPeriod(d(2026, 7, 17))).toEqual({
			from: d(2026, 7, 1),
			toExclusive: d(2026, 8, 1)
		});
	});

	it('wraps the year at December/January', () => {
		expect(monthPeriod(d(2026, 12, 5))).toEqual({
			from: d(2026, 12, 1),
			toExclusive: d(2027, 1, 1)
		});
		expect(previousMonthPeriod(d(2026, 1, 5))).toEqual({
			from: d(2025, 12, 1),
			toExclusive: d(2026, 1, 1)
		});
	});

	it('lists the right number of days (leap February)', () => {
		expect(listDays(monthPeriod(d(2028, 2, 10)))).toHaveLength(29);
		expect(listDays(monthPeriod(d(2026, 2, 10)))).toHaveLength(28);
	});

	it('labels months', () => {
		expect(monthLabel(d(2026, 7, 1))).toBe('July 2026');
	});
});

describe('week periods', () => {
	// 2026-07-17 is a Friday.
	it('honors Monday week start', () => {
		expect(weekPeriod(d(2026, 7, 17), 1)).toEqual({
			from: d(2026, 7, 13),
			toExclusive: d(2026, 7, 20)
		});
	});

	it('honors Sunday week start', () => {
		expect(weekPeriod(d(2026, 7, 17), 7)).toEqual({
			from: d(2026, 7, 12),
			toExclusive: d(2026, 7, 19)
		});
	});

	it('a day on the boundary starts its own week', () => {
		expect(weekPeriod(d(2026, 7, 13), 1).from).toEqual(d(2026, 7, 13));
		expect(weekPeriod(d(2026, 7, 12), 7).from).toEqual(d(2026, 7, 12));
	});

	it('previous week is exactly the 7 days before', () => {
		expect(previousWeekPeriod(d(2026, 7, 17), 1)).toEqual({
			from: d(2026, 7, 6),
			toExclusive: d(2026, 7, 13)
		});
	});
});
