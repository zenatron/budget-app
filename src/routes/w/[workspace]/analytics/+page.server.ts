import { error, fail } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '$lib/server/db';
import { budget } from '$lib/server/db/schema';
import { Money, InvalidMoneyError } from '$lib/domain/money/money';
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
import {
	budgetVsActual,
	bucketCategoryTrend,
	categoryBreakdown,
	dailyTrend,
	memberBreakdown,
	monthlyTrend,
	periodTotal
} from '$lib/server/repo/analytics';
import { incomeInPeriod } from '$lib/server/repo/income';
import { totalSaved, savingsInPeriod } from '$lib/server/repo/buckets';
import { listCategories } from '$lib/server/repo/workspaces';
import { uuidv7 } from '$lib/infra/id/uuidv7';
import { systemClock } from '$lib/infra/time/system-clock';
import type { Actions, PageServerLoad } from './$types';

const DAY_MS = 86_400_000;
const MONTH_NAMES = [
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
const EARLIEST = 2020;

interface PeriodConfig {
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

function resolvePeriod(params: {
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
	const latestYear = today.y + 1;
	const latestMonth = today.m === 12 ? { y: today.y + 1, m: 1 } : { y: today.y, m: today.m + 1 };

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
		const hasNext = nextWeekStart.getTime() <= now.getTime() + 2 * 7 * DAY_MS;
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
		const tomorrow = addDays(today, 1);
		return {
			queryPeriod,
			prevPeriod,
			label: dayLabel(target),
			prevLabel: 'yesterday',
			buckets,
			showBudgets: false,
			hasPrev: compareDates(target, earliest) > 0,
			hasNext: compareDates(target, tomorrow) < 0,
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

export const load: PageServerLoad = async ({ locals, url }) => {
	const db = getDb();
	const now = systemClock.now();
	const ws = locals.workspace!;
	const scope = { workspaceId: ws.id, viewerId: locals.member!.id, timezone: ws.timezone };
	const today = calDateInZone(now, ws.timezone);
	const pad = (n: number) => String(n).padStart(2, '0');
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const weekStartDay = (ws as any).weekStartDay ?? 1;

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

	const weekOffset = parseInt(url.searchParams.get('wo') ?? '0');

	const cfg = resolvePeriod({
		period,
		target,
		today,
		now,
		timezone: ws.timezone,
		weekStartDay,
		weekOffset,
		pad
	});

	const trendFn = period === 'year' ? monthlyTrend : dailyTrend;
	const trend = await trendFn(db, scope, cfg.queryPeriod, now);

	const [
		total,
		prevTotal,
		categories,
		members,
		budgets,
		allCategories,
		periodIncome,
		prevIncome,
		savingsTotal,
		periodSavings,
		barCats
	] = await Promise.all([
		periodTotal(db, scope, cfg.queryPeriod, now),
		periodTotal(db, scope, cfg.prevPeriod, now),
		categoryBreakdown(db, scope, cfg.queryPeriod, now),
		memberBreakdown(db, scope, cfg.queryPeriod, now),
		cfg.showBudgets ? budgetVsActual(db, scope, cfg.queryPeriod, now) : Promise.resolve([]),
		listCategories(db, ws.id),
		incomeInPeriod(db, ws.id, cfg.queryPeriod, ws.timezone, today),
		incomeInPeriod(db, ws.id, cfg.prevPeriod, ws.timezone, today),
		totalSaved(db, ws.id),
		savingsInPeriod(db, ws.id, cfg.queryPeriod, ws.timezone),
		period !== 'day'
			? bucketCategoryTrend(db, scope, cfg.queryPeriod, now, period === 'year' ? 'month' : 'day')
			: Promise.resolve(new Map())
	]);

	return {
		period,
		label: cfg.label,
		prevLabel: cfg.prevLabel,
		totalMinor: total,
		prevTotalMinor: prevTotal,
		incomeMinor: periodIncome,
		prevIncomeMinor: prevIncome,
		savingsMinor: periodSavings,
		categories: categories.map((c) => ({ ...c })),
		members: members.map((m) => ({ ...m })),
		buckets: cfg.buckets.map((b) => {
			let href: string | null = null;
			if (period === 'year') href = `?period=month&month=${b.key}`;
			else if (period === 'month' || period === 'week') href = `?period=day&day=${b.key}`;
			const segs: { value: bigint; color: string }[] = [];
			if (barCats.size > 0) {
				allCategories.forEach((c) => {
					const v = barCats.get(`${b.key}:${c.id}`) ?? 0n;
					if (v > 0n) segs.push({ value: v, color: c.color ?? '#8E8E93' });
				});
				const uncat = barCats.get(`${b.key}:__none__`) ?? 0n;
				if (uncat > 0n) segs.push({ value: uncat, color: '#8E8E93' });
			}
			return { ...b, totalMinor: trend.get(b.key) ?? 0n, href, segments: segs };
		}),
		budgets: budgets.map((b) => ({ ...b })),
		allCategories: allCategories.map((c) => ({ id: c.id, name: c.name, icon: c.icon })),
		isOwner: locals.member!.role === 'owner',
		hasPrev: cfg.hasPrev,
		hasNext: cfg.hasNext,
		dayParam:
			period === 'day'
				? `${target.y}-${pad(target.m)}-${pad(target.d)}`
				: `${today.y}-${pad(today.m)}-${pad(today.d)}`,
		prevDay: cfg.nav.prevDay,
		nextDay: cfg.nav.nextDay,
		prevWeekOffset: cfg.nav.prevWeekOffset,
		nextWeekOffset: cfg.nav.nextWeekOffset,
		monthParam: period === 'month' ? `${target.y}-${pad(target.m)}` : `${today.y}-${pad(today.m)}`,
		prevMonth: cfg.nav.prevMonth,
		nextMonth: cfg.nav.nextMonth,
		yearParam: period === 'year' ? String(target.y) : String(today.y),
		prevYear: period === 'year' ? String(target.y - 1) : String(today.y),
		nextYear: period === 'year' ? String(target.y + 1) : String(today.y)
	};
};

const BudgetSchema = v.object({
	categoryId: v.optional(v.string()),
	amount: v.pipe(v.string(), v.trim(), v.minLength(1, 'How much?'))
});

export const actions: Actions = {
	setBudget: async ({ locals, request }) => {
		if (locals.member!.role !== 'owner') error(403, 'Only the owner can set budgets');
		const parsed = v.safeParse(BudgetSchema, Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.issues[0].message });
		const categoryId = parsed.output.categoryId || null;

		let amount: Money;
		try {
			amount = Money.fromDecimal(parsed.output.amount, locals.workspace!.currency);
		} catch (e) {
			if (e instanceof InvalidMoneyError) return fail(400, { error: e.message });
			throw e;
		}
		if (!amount.isPositive) return fail(400, { error: 'Budget must be positive' });

		const db = getDb();
		const now = systemClock.now();
		const today = calDateInZone(now, locals.workspace!.timezone);
		const pad = (n: number) => String(n).padStart(2, '0');
		const monthStart = `${today.y}-${pad(today.m)}-01`;

		await db
			.delete(budget)
			.where(
				and(
					eq(budget.workspaceId, locals.workspace!.id),
					eq(budget.period, 'month'),
					categoryId === null ? isNull(budget.categoryId) : eq(budget.categoryId, categoryId)
				)
			);
		await db.insert(budget).values({
			id: uuidv7.newId(),
			workspaceId: locals.workspace!.id,
			categoryId,
			period: 'month',
			amountMinor: amount.minor,
			effectiveFrom: monthStart,
			effectiveTo: null
		});
		return { ok: true };
	},

	deleteBudget: async ({ locals, request }) => {
		if (locals.member!.role !== 'owner') error(403, 'Only the owner can change budgets');
		const budgetId = String((await request.formData()).get('budgetId') ?? '');
		await getDb()
			.delete(budget)
			.where(and(eq(budget.id, budgetId), eq(budget.workspaceId, locals.workspace!.id)));
		return { ok: true };
	}
};
