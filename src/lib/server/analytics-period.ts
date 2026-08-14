/**
 * The period the Activity screens are looking at, resolved once.
 *
 * Extracted from the analytics page when the map became a second screen with
 * the same day/week/month/year control. Two copies of this would have drifted
 * on what "week" means the first time either was touched, and the two screens
 * are meant to be the same view of the same window — you step the period on the
 * map and the list agrees, or the feature is lying.
 */

import {
	listDays,
	listMonths,
	monthLabel,
	monthPeriod,
	previousMonthPeriod,
	weekPeriod,
	previousWeekPeriod,
	yearLabel,
	yearPeriod,
	previousYearPeriod,
	dayLabel,
	dayPeriod,
	previousDayPeriod
} from '$lib/domain/analytics/period';
import { addDays, compareDates } from '$lib/domain/recurrence/rrule';
import { calDateInZone } from '$lib/domain/time/zoned';

export const pad = (n: number) => String(n).padStart(2, '0');

const DAY_MS = 86_400_000;
export const MONTH_NAMES = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
];
export const EARLIEST = 2020;

export interface PeriodConfig {
	queryPeriod: ReturnType<typeof yearPeriod>;
	prevPeriod: ReturnType<typeof yearPeriod>;
	label: string;
	prevLabel: string;
	buckets: Array<{ label: string; key: string; today: boolean; weekLabel?: string }>;
	showBudgets: boolean;
	hasPrev: boolean;
	hasNext: boolean;
	nav: {
		prevMonth: string;
		nextMonth: string;
		prevDay: string;
		nextDay: string;
		prevWeekOffset: number;
		nextWeekOffset: number;
	};
}

export function resolvePeriod(params: {
	period: string;
	target: ReturnType<typeof calDateInZone>;
	today: ReturnType<typeof calDateInZone>;
	now: Date;
	timezone: string;
	weekStartDay: number;
	weekOffset: number;
	pad: (n: number) => string;
}): PeriodConfig {
	const { period, target, today, now, timezone, weekStartDay, weekOffset, pad } = params;
	// The current period is the last one you can reach. A future period has
	// nothing in it by construction — purchases only exist once materialized, and
	// incomeInPeriod stops expanding at today — so it rendered as an empty screen
	// captioned "100% less than last month", which reads as an achievement rather
	// than as a month that hasn't happened. Day already worked this way; week,
	// month and year each allowed a different amount of lookahead.
	const latestYear = today.y;
	const latestMonth = { y: today.y, m: today.m };

	if (period === 'week') {
		const base = calDateInZone(new Date(now.getTime() + weekOffset * 7 * DAY_MS), timezone);
		const queryPeriod = weekPeriod(base, weekStartDay);
		const prevPeriod = previousWeekPeriod(base, weekStartDay);
		const end = new Date(
			queryPeriod.toExclusive.y,
			queryPeriod.toExclusive.m - 1,
			queryPeriod.toExclusive.d - 1
		);
		const label = `${MONTH_NAMES[queryPeriod.from.m - 1]} ${queryPeriod.from.d} – ${MONTH_NAMES[end.getMonth()]} ${end.getDate()}`;
		const buckets = listDays(queryPeriod).map((d) => {
			const dow = new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay();
			return {
				label: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][dow],
				key: `${d.y}-${pad(d.m)}-${pad(d.d)}`,
				today: d.d === today.d && d.m === today.m && d.y === today.y,
				weekLabel: undefined
			};
		});
		const hasPrev = queryPeriod.from.y >= EARLIEST;
		const nextWeekStart = new Date(
			queryPeriod.toExclusive.y,
			queryPeriod.toExclusive.m - 1,
			queryPeriod.toExclusive.d
		);
		// Stop at the week containing today, not two weeks past it.
		const hasNext = nextWeekStart.getTime() <= now.getTime();
		return {
			queryPeriod,
			prevPeriod,
			label,
			prevLabel: 'last week',
			buckets,
			showBudgets: false,
			hasPrev,
			hasNext,
			nav: {
				prevMonth: `${today.y}-${pad(today.m)}`,
				nextMonth: `${today.y}-${pad(today.m)}`,
				prevDay: `${today.y}-${pad(today.m)}-${pad(today.d)}`,
				nextDay: `${today.y}-${pad(today.m)}-${pad(today.d)}`,
				prevWeekOffset: weekOffset - 1,
				nextWeekOffset: weekOffset + 1
			}
		};
	}

	if (period === 'year') {
		const queryPeriod = yearPeriod(target);
		const prevPeriod = previousYearPeriod(target);
		const buckets = listMonths(queryPeriod).map((m) => ({
			label: m.label,
			key: `${target.y}-${pad(m.m)}`,
			today: m.m === today.m && target.y === today.y,
			weekLabel: undefined
		}));
		return {
			queryPeriod,
			prevPeriod,
			label: yearLabel(target),
			prevLabel: 'last year',
			buckets,
			showBudgets: false,
			hasPrev: target.y > EARLIEST,
			hasNext: target.y < latestYear,
			nav: {
				prevMonth: `${today.y}-${pad(today.m)}`,
				nextMonth: `${today.y}-${pad(today.m)}`,
				prevDay: `${today.y}-${pad(today.m)}-${pad(today.d)}`,
				nextDay: `${today.y}-${pad(today.m)}-${pad(today.d)}`,
				prevWeekOffset: 0,
				nextWeekOffset: 0
			}
		};
	}

	if (period === 'day') {
		const queryPeriod = dayPeriod(target);
		const prevPeriod = previousDayPeriod(target);
		const nd = addDays(target, 1);
		const pd = addDays(target, -1);
		const buckets = [
			{
				label: String(target.d),
				key: `${target.y}-${pad(target.m)}-${pad(target.d)}`,
				today: true,
				weekLabel: undefined
			}
		];
		const earliest = { y: EARLIEST, m: 1, d: 1 };
		return {
			queryPeriod,
			prevPeriod,
			label: dayLabel(target),
			prevLabel: 'yesterday',
			buckets,
			showBudgets: false,
			hasPrev: compareDates(target, earliest) > 0,
			// Strictly before today — comparing against tomorrow let you step onto
			// tomorrow itself, which is always an empty day.
			hasNext: compareDates(target, today) < 0,
			nav: {
				prevMonth: `${today.y}-${pad(today.m)}`,
				nextMonth: `${today.y}-${pad(today.m)}`,
				prevDay: `${pd.y}-${pad(pd.m)}-${pad(pd.d)}`,
				nextDay: `${nd.y}-${pad(nd.m)}-${pad(nd.d)}`,
				prevWeekOffset: 0,
				nextWeekOffset: 0
			}
		};
	}

	// month (default)
	const queryPeriod = monthPeriod(target);
	const prevPeriod = previousMonthPeriod(target);
	const nm = target.m === 12 ? { y: target.y + 1, m: 1 } : { y: target.y, m: target.m + 1 };
	const pm = target.m === 1 ? { y: target.y - 1, m: 12 } : { y: target.y, m: target.m - 1 };
	const buckets = listDays(queryPeriod).map((d) => {
		const w = Math.ceil(d.d / 7);
		const isWeekStart = d.d === 1 || d.d === 8 || d.d === 15 || d.d === 22 || d.d === 29;
		return {
			label: String(d.d),
			key: `${d.y}-${pad(d.m)}-${pad(d.d)}`,
			today: d.d === today.d && d.m === today.m && d.y === today.y,
			weekLabel: isWeekStart ? `W${w}` : undefined
		};
	});
	return {
		queryPeriod,
		prevPeriod,
		label: monthLabel(target),
		prevLabel: 'last month',
		buckets,
		showBudgets: true,
		hasPrev: target.y > EARLIEST || (target.y === EARLIEST && target.m > 1),
		hasNext: target.y < latestMonth.y || (target.y === latestMonth.y && target.m < latestMonth.m),
		nav: {
			prevMonth: `${pm.y}-${pad(pm.m)}`,
			nextMonth: `${nm.y}-${pad(nm.m)}`,
			prevDay: `${today.y}-${pad(today.m)}-${pad(today.d)}`,
			nextDay: `${today.y}-${pad(today.m)}-${pad(today.d)}`,
			prevWeekOffset: 0,
			nextWeekOffset: 0
		}
	};
}

/**
 * Read the period straight off a URL. Both Activity and the map call this, so
 * `?period=week&wo=-1` means exactly one thing across the app.
 */
export function periodFromUrl(
	url: URL,
	ws: { timezone: string; weekStartDay?: number },
	now: Date
): { period: string; target: ReturnType<typeof calDateInZone>; cfg: PeriodConfig } {
	const today = calDateInZone(now, ws.timezone);
	const period = url.searchParams.get('period') ?? 'month';
	let target = today;

	const monthParam = url.searchParams.get('month');
	const yearParam = url.searchParams.get('year');
	const dayParam = url.searchParams.get('day');

	if (period === 'year' && yearParam && /^\d{4}$/.test(yearParam)) {
		target = { y: parseInt(yearParam), m: 7, d: 1 };
	} else if (period === 'month' && monthParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam)) {
		const [y, m] = monthParam.split('-').map(Number);
		target = { y, m, d: 1 };
	} else if (period === 'day' && dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam)) {
		const [y, m, d] = dayParam.split('-').map(Number);
		target = { y, m, d };
	}

	const cfg = resolvePeriod({
		period,
		target,
		today,
		now,
		timezone: ws.timezone,
		weekStartDay: ws.weekStartDay ?? 1,
		weekOffset: parseInt(url.searchParams.get('wo') ?? '0'),
		pad
	});

	return { period, target, cfg };
}
