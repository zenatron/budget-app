import { and, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { budget, purchase, workspace, workspaceMember } from '$lib/server/db/schema';
import { calDateInZone, zonedTimeToUtc } from '$lib/domain/time/zoned';
import { monthPeriod } from '$lib/domain/analytics/period';
import { Money } from '$lib/domain/money/money';
import type { Clock } from '$lib/ports/clock';
import type { Notifier, Recipient } from '$lib/ports/notifier';

const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export async function checkBudgetAlerts(
	db: Db,
	deps: { clock: Clock; notifier: Notifier }
): Promise<number> {
	const now = deps.clock.now();

	const workspaces = await db
		.select({
			id: workspace.id,
			name: workspace.name,
			slug: workspace.slug,
			timezone: workspace.timezone,
			currency: workspace.currency,
			ownerUserId: workspace.ownerUserId
		})
		.from(workspace);

	let alerted = 0;
	for (const ws of workspaces) {
		const today = calDateInZone(now, ws.timezone);
		const period = monthPeriod(today);
		const from = zonedTimeToUtc(period.from, 0, 0, ws.timezone);
		const to = zonedTimeToUtc(period.toExclusive, 0, 0, ws.timezone);

		const pad = (n: number) => String(n).padStart(2, '0');
		const fromStr = `${period.from.y}-${pad(period.from.m)}-${pad(period.from.d)}`;

		const budgets = await db
			.select()
			.from(budget)
			.where(
				and(
					eq(budget.workspaceId, ws.id),
					eq(budget.period, 'month'),
					lte(budget.effectiveFrom, fromStr),
					or(isNull(budget.effectiveTo), gt(budget.effectiveTo, fromStr))
				)
			);

		if (budgets.length === 0) continue;

		const [ownerMember] = await db
			.select({
				memberId: workspaceMember.id,
				userId: workspaceMember.userId
			})
			.from(workspaceMember)
			.where(
				and(
					eq(workspaceMember.workspaceId, ws.id),
					eq(workspaceMember.userId, ws.ownerUserId),
					eq(workspaceMember.status, 'active')
				)
			)
			.limit(1);
		if (!ownerMember) continue;

		for (const b of budgets) {
			if (b.lastAlertedAt && now.getTime() - b.lastAlertedAt.getTime() < ALERT_COOLDOWN_MS) {
				continue;
			}

			const conditions: Parameters<typeof and>[0][] = [
				eq(purchase.workspaceId, ws.id),
				inArray(purchase.state, ['completed', 'refunded']),
				gte(purchase.completedAt, from),
				lt(purchase.completedAt, to)
			];
			if (b.categoryId !== null) {
				conditions.push(eq(purchase.categoryId, b.categoryId));
			}

			const [row] = await db
				.select({
					total: sql<string>`coalesce(sum(${purchase.finalAmountMinor}), 0)`
				})
				.from(purchase)
				.where(and(...conditions));

			const actualMinor = BigInt(row.total);
			const budgetMinor = b.amountMinor;
			const eightyPctMinor = (budgetMinor * 80n) / 100n;

			if (actualMinor <= eightyPctMinor) continue;

			const over = actualMinor > budgetMinor;
			const budgetMoney = Money.of(budgetMinor, ws.currency);
			const actualMoney = Money.of(actualMinor, ws.currency);

			const recipients: Recipient[] = [
				{ userId: ownerMember.userId, memberId: ownerMember.memberId }
			];

			// Claim the alert before sending it. The conditional update is the
			// real cooldown gate — the check above is just a cheap pre-filter, and
			// two overlapping sweeps would both pass it. Only the winner notifies.
			const claimed = await db
				.update(budget)
				.set({ lastAlertedAt: now })
				.where(
					and(
						eq(budget.id, b.id),
						or(
							isNull(budget.lastAlertedAt),
							lt(budget.lastAlertedAt, new Date(now.getTime() - ALERT_COOLDOWN_MS))
						)
					)
				)
				.returning({ id: budget.id });
			if (claimed.length === 0) continue;

			await deps.notifier.notify(recipients, 'budget_exceeded', {
				title: over ? `Budget exceeded in ${ws.name}` : `Budget nearing limit in ${ws.name}`,
				body: `Spent ${actualMoney.format()} of ${budgetMoney.format()} this month`,
				path: `/w/${ws.slug}/analytics`,
				tag: `budget-alert:${b.id}`
			});

			alerted += 1;
		}
	}

	return alerted;
}
