import { error, fail } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '$lib/server/db';
import { budget } from '$lib/server/db/schema';
import { Money, InvalidMoneyError } from '$lib/domain/money/money';
import {
	listDays,
	monthLabel,
	monthPeriod,
	previousMonthPeriod
} from '$lib/domain/analytics/period';
import { calDateInZone } from '$lib/domain/time/zoned';
import {
	budgetVsActual,
	categoryBreakdown,
	dailyTrend,
	memberBreakdown,
	periodTotal
} from '$lib/server/repo/analytics';
import { incomeInPeriod } from '$lib/server/repo/income';
import { listCategories } from '$lib/server/repo/workspaces';
import { uuidv7 } from '$lib/infra/id/uuidv7';
import { systemClock } from '$lib/infra/time/system-clock';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const db = getDb();
	const now = systemClock.now();
	const ws = locals.workspace!;
	const scope = { workspaceId: ws.id, viewerId: locals.member!.id, timezone: ws.timezone };
	const today = calDateInZone(now, ws.timezone);
	const thisMonth = monthPeriod(today);
	const lastMonth = previousMonthPeriod(today);

	const [total, prevTotal, categories, members, trend, budgets, allCategories, monthIncome] =
		await Promise.all([
			periodTotal(db, scope, thisMonth, now),
			periodTotal(db, scope, lastMonth, now),
			categoryBreakdown(db, scope, thisMonth, now),
			memberBreakdown(db, scope, thisMonth, now),
			dailyTrend(db, scope, thisMonth, now),
			budgetVsActual(db, scope, thisMonth, now),
			listCategories(db, ws.id),
			incomeInPeriod(db, ws.id, thisMonth, ws.timezone)
		]);

	const pad = (n: number) => String(n).padStart(2, '0');
	return {
		monthLabel: monthLabel(today),
		totalMinor: total,
		prevTotalMinor: prevTotal,
		incomeMinor: monthIncome,
		categories: categories.map((c) => ({ ...c })),
		members: members.map((m) => ({ ...m })),
		days: listDays(thisMonth).map((d) => {
			const key = `${d.y}-${pad(d.m)}-${pad(d.d)}`;
			return { day: d.d, totalMinor: trend.get(key) ?? 0n };
		}),
		todayDay: today.d,
		budgets: budgets.map((b) => ({ ...b })),
		allCategories: allCategories.map((c) => ({ id: c.id, name: c.name, icon: c.icon })),
		isOwner: locals.member!.role === 'owner'
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

		// One open budget per scope: replace any existing one.
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
