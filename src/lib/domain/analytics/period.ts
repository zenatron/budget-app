/**
 * Period bucketing — the single place date boundaries are computed. All math
 * is on calendar dates in the workspace's timezone; callers convert the
 * resulting boundaries to instants with zonedTimeToUtc at local midnight.
 */

import { addDays, compareDates, daysInMonth, isoWeekday, type CalDate } from '../recurrence/rrule';

export interface Period {
	/** Inclusive. */
	from: CalDate;
	/** Exclusive. */
	toExclusive: CalDate;
}

export function monthPeriod(today: CalDate): Period {
	const from = { y: today.y, m: today.m, d: 1 };
	const next =
		today.m === 12 ? { y: today.y + 1, m: 1, d: 1 } : { y: today.y, m: today.m + 1, d: 1 };
	return { from, toExclusive: next };
}

export function previousMonthPeriod(today: CalDate): Period {
	const prev =
		today.m === 1 ? { y: today.y - 1, m: 12, d: 1 } : { y: today.y, m: today.m - 1, d: 1 };
	return monthPeriod(prev);
}

/** weekStartDay: ISO 1 (Monday) … 7 (Sunday). */
export function weekPeriod(today: CalDate, weekStartDay: number): Period {
	const offset = (isoWeekday(today) - weekStartDay + 7) % 7;
	const from = addDays(today, -offset);
	return { from, toExclusive: addDays(from, 7) };
}

export function previousWeekPeriod(today: CalDate, weekStartDay: number): Period {
	const current = weekPeriod(today, weekStartDay);
	return { from: addDays(current.from, -7), toExclusive: current.from };
}

/** Every date in the period, in order — the x-axis of a trend chart. */
export function listDays(period: Period): CalDate[] {
	const days: CalDate[] = [];
	for (let d = period.from; compareDates(d, period.toExclusive) < 0; d = addDays(d, 1)) {
		days.push(d);
		if (days.length > 400) break; // safety valve
	}
	return days;
}

export function daysInPeriod(period: Period): number {
	return listDays(period).length;
}

const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

export function monthLabel(date: CalDate): string {
	return `${MONTHS[date.m - 1]} ${date.y}`;
}

export function yearPeriod(today: CalDate): Period {
	return {
		from: { y: today.y, m: 1, d: 1 },
		toExclusive: { y: today.y + 1, m: 1, d: 1 }
	};
}

export function previousYearPeriod(today: CalDate): Period {
	return {
		from: { y: today.y - 1, m: 1, d: 1 },
		toExclusive: { y: today.y, m: 1, d: 1 }
	};
}

export function yearLabel(date: CalDate): string {
	return `${date.y}`;
}

export function dayPeriod(date: CalDate): Period {
	return { from: date, toExclusive: addDays(date, 1) };
}

export function previousDayPeriod(date: CalDate): Period {
	return dayPeriod(addDays(date, -1));
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function dayLabel(date: CalDate): string {
	const d = new Date(Date.UTC(date.y, date.m - 1, date.d));
	return `${DAY_NAMES[d.getUTCDay()]}, ${MONTHS[date.m - 1]} ${date.d}, ${date.y}`;
}

/** Months in the period as "Jan", "Feb", etc. */
export function listMonths(period: Period): { m: number; label: string }[] {
	const months: { m: number; label: string }[] = [];
	for (
		let m = period.from.m;
		m < (period.toExclusive.y > period.from.y ? 13 : period.toExclusive.m);
		m++
	) {
		months.push({ m, label: MONTHS[m - 1].slice(0, 3) });
	}
	return months;
}

export { daysInMonth };
