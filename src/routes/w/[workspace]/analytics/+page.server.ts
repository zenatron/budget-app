import { error, fail } from '@sveltejs/kit';
import { and, asc, eq, gt, isNull } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '$lib/server/db';
import { budget, category } from '$lib/db/schema';
import { Money, InvalidMoneyError } from '$lib/domain/money/money';
import { yearPeriod } from '$lib/domain/analytics/period';
import { addDays } from '$lib/domain/recurrence/rrule';
import { calDateInZone } from '$lib/domain/time/zoned';
import {
	budgetVsActual,
	bucketCategoryTrend,
	categoryBreakdown,
	dailyTrend,
	memberBreakdown,
	monthlyTrend,
	hasAnyPlace,
	periodTotal,
	placeBreakdown,
	verdictTotals
} from '$lib/repo/analytics';
import { incomeInPeriod } from '$lib/repo/income';
import { setBudget } from '$lib/repo/budgets';
import { bucketFlowsInPeriod, lifetimeSaved, totalSaved } from '$lib/repo/buckets';
import { listCategories } from '$lib/repo/workspaces';
import { uuidv7 } from '$lib/infra/id/uuidv7';
import { systemClock } from '$lib/infra/time/system-clock';
import { EARLIEST, MONTH_NAMES, pad, periodFromUrl } from '$lib/server/analytics-period';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url, params }) => {
	// Also depend on the workspace param so a switch always re-runs this load,
	// independent of how finely SvelteKit tracks url/params. See +layout.server.ts.
	void params.workspace;
	const db = getDb();
	const now = systemClock.now();
	const ws = locals.workspace!;
	const scope = { workspaceId: ws.id, viewerId: locals.member!.id, timezone: ws.timezone };
	const today = calDateInZone(now, ws.timezone);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const weekStartDay = (ws as any).weekStartDay ?? 1;

	// Shared with the map, so stepping the period on one screen means exactly
	// what it means on the other. See server/analytics-period.
	const { period, target, cfg } = periodFromUrl(url, { timezone: ws.timezone, weekStartDay }, now);

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
		periodBuckets,
		barCats,
		places,
		hasPlaces
	] = await Promise.all([
		periodTotal(db, scope, cfg.queryPeriod, now),
		periodTotal(db, scope, cfg.prevPeriod, now),
		categoryBreakdown(db, scope, cfg.queryPeriod, now),
		memberBreakdown(db, scope, cfg.queryPeriod, now),
		cfg.showBudgets ? budgetVsActual(db, scope, cfg.queryPeriod, now) : Promise.resolve([]),
		listCategories(db, ws.id),
		incomeInPeriod(db, ws.id, cfg.queryPeriod, ws.timezone, today),
		incomeInPeriod(db, ws.id, cfg.prevPeriod, ws.timezone, today),
		bucketFlowsInPeriod(db, ws.id, cfg.queryPeriod, ws.timezone),
		period !== 'day'
			? bucketCategoryTrend(db, scope, cfg.queryPeriod, now, period === 'year' ? 'month' : 'day')
			: Promise.resolve(new Map()),
		// Seal-filtered like every other figure on this page: a purchase this
		// viewer cannot see contributes no place they can see.
		ws.locationEnabled ? placeBreakdown(db, scope, cfg.queryPeriod, now, 6) : Promise.resolve([]),
		// Not period-scoped, deliberately: the map affordance should appear once
		// this workspace has ever pinned anything, rather than vanishing when you
		// step back to a month from before places existed.
		ws.locationEnabled ? hasAnyPlace(db, scope, now) : Promise.resolve(false)
	]);

	// Lifetime, not period-scoped: running totals for the workspace.
	// Income has no stored lifetime figure — recurring entries are rrule
	// templates expanded at query time — so it's summed over the whole range the
	// app admits data for.
	const allTime = yearPeriod({ y: EARLIEST, m: 1, d: 1 });
	allTime.toExclusive = { y: today.y + 1, m: 1, d: 1 };
	const [verdicts, earnedMinor, savedMinor, onHandMinor] = await Promise.all([
		verdictTotals(db, scope, now),
		incomeInPeriod(db, ws.id, allTime, ws.timezone, today),
		lifetimeSaved(db, ws.id),
		// What the buckets hold right now, as opposed to what went into them this
		// period — the line under net position is answering "how much have I got
		// put by?", which is a balance, not a flow.
		totalSaved(db, ws.id)
	]);

	// Budgets that start after the current month — scheduled, not yet in force.
	// Surfaced so a plan you made months ago is visible rather than a surprise.
	const scheduled = cfg.showBudgets
		? await db
				.select({
					id: budget.id,
					categoryId: budget.categoryId,
					amountMinor: budget.amountMinor,
					effectiveFrom: budget.effectiveFrom,
					categoryName: category.name,
					categoryIcon: category.icon
				})
				.from(budget)
				.leftJoin(category, eq(budget.categoryId, category.id))
				.where(
					and(
						eq(budget.workspaceId, ws.id),
						eq(budget.period, 'month'),
						gt(budget.effectiveFrom, `${today.y}-${pad(today.m)}-01`)
					)
				)
				.orderBy(asc(budget.effectiveFrom))
		: [];

	// The window as inclusive calendar dates, for links into the ledger. The
	// period is half-open internally; `to` steps back a day so the link reads the
	// way a person does — "Jun 1 – Jun 30", not "Jun 1 – Jul 1".
	const lastDay = addDays(cfg.queryPeriod.toExclusive, -1);
	const rangeFrom = `${cfg.queryPeriod.from.y}-${pad(cfg.queryPeriod.from.m)}-${pad(cfg.queryPeriod.from.d)}`;
	const rangeTo = `${lastDay.y}-${pad(lastDay.m)}-${pad(lastDay.d)}`;

	return {
		period,
		label: cfg.label,
		prevLabel: cfg.prevLabel,
		rangeFrom,
		rangeTo,
		totalMinor: total,
		prevTotalMinor: prevTotal,
		incomeMinor: periodIncome,
		prevIncomeMinor: prevIncome,
		// Set aside / released / overdraft rather than one signed "savings" figure.
		// See domain/bucket/flows: netting them let a charge against an empty
		// bucket read as negative savings, which then *added* to net position.
		savingsMinor: periodBuckets.setAsideMinor,
		releasedMinor: periodBuckets.releasedMinor,
		overdraftMinor: periodBuckets.overdraftMinor,
		categories: categories.map((c) => ({ ...c })),
		members: members.map((m) => ({ ...m })),
		locationEnabled: ws.locationEnabled,
		hasPlaces,
		// A section captioned with a single row isn't a section — one pinned
		// purchase is a fact about that purchase, not a pattern worth a heading.
		places: places.length >= 2 ? places.map((p) => ({ ...p })) : [],
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
		budgetMonths: cfg.showBudgets ? schedulableMonths(today) : [],
		scheduledBudgets: scheduled.map((s) => ({
			id: s.id,
			categoryId: s.categoryId,
			categoryName: s.categoryName,
			categoryIcon: s.categoryIcon,
			amountMinor: s.amountMinor,
			effectiveFrom: s.effectiveFrom,
			// "2026-09-01" -> "Sep 2026"
			label: `${MONTH_NAMES[Number(s.effectiveFrom.slice(5, 7)) - 1]} ${s.effectiveFrom.slice(0, 4)}`
		})),
		allCategories: allCategories.map((c) => ({ id: c.id, name: c.name, icon: c.icon })),
		verdicts,
		earnedMinor,
		savedMinor,
		onHandMinor,
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

/** How far ahead a budget may be scheduled, in months. */
const MAX_BUDGET_LEAD_MONTHS = 12;

const BudgetSchema = v.object({
	categoryId: v.optional(v.string()),
	amount: v.pipe(v.string(), v.trim(), v.minLength(1, 'How much?')),
	// YYYY-MM. Absent means "this month", which is what the form defaults to.
	effectiveMonth: v.optional(v.pipe(v.string(), v.regex(/^\d{4}-\d{2}$/, 'Pick a month')))
});

/** Months a budget can be scheduled for: this month through +12. */
function schedulableMonths(today: { y: number; m: number }) {
	const out: { value: string; label: string }[] = [];
	for (let i = 0; i <= MAX_BUDGET_LEAD_MONTHS; i++) {
		const m0 = today.m - 1 + i;
		const y = today.y + Math.floor(m0 / 12);
		const m = (m0 % 12) + 1;
		out.push({
			value: `${y}-${String(m).padStart(2, '0')}`,
			label: i === 0 ? 'This month' : `${MONTH_NAMES[m - 1]} ${y}`
		});
	}
	return out;
}

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

		const allowed = schedulableMonths(today);
		const chosen = parsed.output.effectiveMonth ?? allowed[0].value;
		if (!allowed.some((m) => m.value === chosen)) {
			return fail(400, { error: `Pick a month between now and ${allowed.at(-1)!.label}` });
		}
		const from = `${chosen}-01`;

		// Timeline write (close the open range, inherit the next start, replace an
		// exact match) lives in one place so the MCP set_budget tool shares it.
		await setBudget(db, uuidv7, {
			workspaceId: locals.workspace!.id,
			categoryId,
			amountMinor: amount.minor,
			effectiveFrom: from
		});
		return { ok: true };
	},

	/** Drop a scheduled budget and reopen the range that preceded it. */
	removeScheduledBudget: async ({ locals, request }) => {
		if (locals.member!.role !== 'owner') error(403, 'Only the owner can set budgets');
		const id = String((await request.formData()).get('budgetId') ?? '');
		const db = getDb();
		const today = calDateInZone(systemClock.now(), locals.workspace!.timezone);
		const pad = (n: number) => String(n).padStart(2, '0');
		const thisMonth = `${today.y}-${pad(today.m)}-01`;

		await db.transaction(async (tx) => {
			const [row] = await tx
				.select()
				.from(budget)
				.where(and(eq(budget.id, id), eq(budget.workspaceId, locals.workspace!.id)))
				.limit(1);
			// Only future rows are removable here; past ones are history.
			if (!row || row.effectiveFrom <= thisMonth) return;

			await tx.delete(budget).where(eq(budget.id, id));
			await tx
				.update(budget)
				.set({ effectiveTo: row.effectiveTo })
				.where(
					and(
						eq(budget.workspaceId, locals.workspace!.id),
						eq(budget.period, 'month'),
						row.categoryId === null
							? isNull(budget.categoryId)
							: eq(budget.categoryId, row.categoryId),
						eq(budget.effectiveTo, row.effectiveFrom)
					)
				);
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
