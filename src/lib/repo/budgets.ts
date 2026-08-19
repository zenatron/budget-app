import { and, asc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import type { Db } from '$lib/db/types';
import { budget } from '$lib/db/schema';
import { weekPeriod } from '$lib/domain/analytics/period';
import type { IdGenerator } from '$lib/ports/id-generator';

/** This month through +12 — the window a monthly budget may be scheduled for. */
export const MAX_BUDGET_LEAD_MONTHS = 12;
/** This week through +12 — the same lead, on the weekly clock. */
export const MAX_BUDGET_LEAD_WEEKS = 12;

export type BudgetPeriodKind = 'month' | 'week';

export interface SetBudgetCmd {
	workspaceId: string;
	/** null = the overall (all-category) budget. */
	categoryId: string | null;
	amountMinor: bigint;
	/**
	 * First day of the effective period: 'YYYY-MM-01' for a monthly budget, the
	 * week's first day 'YYYY-MM-DD' for a weekly one.
	 */
	effectiveFrom: string;
	/** Monthly and weekly budgets are separate timelines over the same scope. */
	period: BudgetPeriodKind;
}

/**
 * Set (or replace) a budget line, effective from a given period.
 *
 * Budgets are a timeline, not a single value: reads select the row effective
 * for the period being viewed, so a write must keep ranges adjacent and
 * non-overlapping rather than clobbering history. This is the single writer —
 * the analytics page and the MCP set_budget tool both call it.
 *
 * Monthly and weekly budgets never touch each other: the timeline is scoped
 * by period kind as well as category, so a weekly grocery cap and a monthly
 * one coexist without one truncating the other.
 *
 * Closes the open range at `effectiveFrom`, inherits the start of whatever is
 * already scheduled after it, and replaces any line that already starts exactly
 * there. Extracted verbatim from the analytics page action.
 */
export async function setBudget(db: Db, ids: IdGenerator, cmd: SetBudgetCmd): Promise<void> {
	const scope = and(
		eq(budget.workspaceId, cmd.workspaceId),
		eq(budget.period, cmd.period),
		cmd.categoryId === null ? isNull(budget.categoryId) : eq(budget.categoryId, cmd.categoryId)
	);
	const from = cmd.effectiveFrom;

	await db.transaction(async (tx) => {
		// Replacing a budget that already starts exactly here.
		await tx.delete(budget).where(and(scope, eq(budget.effectiveFrom, from)));

		const [next] = await tx
			.select({ from: budget.effectiveFrom })
			.from(budget)
			.where(and(scope, gt(budget.effectiveFrom, from)))
			.orderBy(asc(budget.effectiveFrom))
			.limit(1);

		// Truncate the range this one starts inside of.
		await tx
			.update(budget)
			.set({ effectiveTo: from })
			.where(
				and(
					scope,
					lt(budget.effectiveFrom, from),
					or(isNull(budget.effectiveTo), gt(budget.effectiveTo, from))
				)
			);

		await tx.insert(budget).values({
			id: ids.newId(),
			workspaceId: cmd.workspaceId,
			categoryId: cmd.categoryId,
			period: cmd.period,
			amountMinor: cmd.amountMinor,
			effectiveFrom: from,
			effectiveTo: next?.from ?? null
		});
	});
}

/** Months a monthly budget can be scheduled for: this month through +MAX_BUDGET_LEAD_MONTHS. */
export function schedulableBudgetMonths(today: { y: number; m: number }): string[] {
	const out: string[] = [];
	for (let i = 0; i <= MAX_BUDGET_LEAD_MONTHS; i++) {
		const m0 = today.m - 1 + i;
		const y = today.y + Math.floor(m0 / 12);
		const m = (m0 % 12) + 1;
		out.push(`${y}-${String(m).padStart(2, '0')}`);
	}
	return out;
}

/**
 * Weeks a weekly budget can be scheduled for: this week through
 * +MAX_BUDGET_LEAD_WEEKS, each as its first day 'YYYY-MM-DD'.
 */
export function schedulableBudgetWeeks(
	today: { y: number; m: number; d: number },
	weekStartDay: number
): string[] {
	const out: string[] = [];
	// The domain's own week math — the same convention every week-shaped read
	// uses, so a schedulable week is exactly a week the analytics screen shows.
	let cursor = weekPeriod(today, weekStartDay).from;
	for (let i = 0; i <= MAX_BUDGET_LEAD_WEEKS; i++) {
		out.push(`${cursor.y}-${pad(cursor.m)}-${pad(cursor.d)}`);
		const next = new Date(Date.UTC(cursor.y, cursor.m - 1, cursor.d) + 7 * 86_400_000);
		cursor = { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() };
	}
	return out;
}

const pad = (n: number) => String(n).padStart(2, '0');
