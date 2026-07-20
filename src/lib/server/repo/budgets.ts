import { and, asc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { budget } from '$lib/server/db/schema';
import type { IdGenerator } from '$lib/ports/id-generator';

/** This month through +12 — the window a budget may be scheduled for. */
export const MAX_BUDGET_LEAD_MONTHS = 12;

export interface SetBudgetCmd {
	workspaceId: string;
	/** null = the overall (all-category) budget. */
	categoryId: string | null;
	amountMinor: bigint;
	/** First day of the effective month, 'YYYY-MM-01'. */
	effectiveFrom: string;
}

/**
 * Set (or replace) a monthly budget line, effective from a given month.
 *
 * Budgets are a timeline, not a single value: reads select the row effective
 * for the month being viewed, so a write must keep ranges adjacent and
 * non-overlapping rather than clobbering history. This is the single writer —
 * both the analytics page and the MCP tool call it.
 *
 * Closes the open range at `effectiveFrom`, inherits the start of whatever is
 * already scheduled after it, and replaces any line that already starts exactly
 * there. Extracted verbatim from the analytics page action.
 */
export async function setBudget(db: Db, ids: IdGenerator, cmd: SetBudgetCmd): Promise<void> {
	const scope = and(
		eq(budget.workspaceId, cmd.workspaceId),
		eq(budget.period, 'month'),
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
			period: 'month',
			amountMinor: cmd.amountMinor,
			effectiveFrom: from,
			effectiveTo: next?.from ?? null
		});
	});
}

/** Months a budget can be scheduled for: this month through +MAX_BUDGET_LEAD_MONTHS. */
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
