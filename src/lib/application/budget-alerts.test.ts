import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb, seedWorkspace, type TestDb } from '$lib/repo/_test/harness';
import { setBudget } from '$lib/repo/budgets';
import { checkBudgetAlerts } from '$lib/application/budget-alerts';
import { budgetAlertLog } from '$lib/db/schema';
import type { Notifier, NotificationMessage } from '$lib/ports/notifier';

let h: TestDb;
afterEach(() => h?.close());

// A Wednesday in New York: this week (Monday-start) began Jun 15, this month Jun 1.
const NOW = new Date('2026-06-17T12:00:00Z');

function fakeDeps() {
	const sent: NotificationMessage[] = [];
	const notifier: Notifier = {
		async notify(_recipients, _event, msg) {
			sent.push(msg);
		}
	};
	return {
		deps: { clock: { now: () => NOW }, ids: { newId: () => crypto.randomUUID() }, notifier },
		sent
	};
}

describe('checkBudgetAlerts', () => {
	it('alerts a weekly budget on the week it was overspent, keyed by the week', async () => {
		h = await makeTestDb();
		const ws = await seedWorkspace(h.db, { timezone: 'America/New_York' });
		const groceries = await ws.addCategory('Groceries');
		await setBudget(
			h.db,
			{ newId: () => crypto.randomUUID() },
			{
				workspaceId: ws.workspaceId,
				categoryId: groceries,
				amountMinor: 100_00n,
				effectiveFrom: '2026-06-15',
				period: 'week'
			}
		);
		// $110 spent on Tuesday — inside this week only.
		await ws.addPurchase({
			categoryId: groceries,
			amountMinor: 110_00n,
			state: 'completed',
			completedAt: new Date('2026-06-16T15:00:00Z')
		});

		const { deps, sent } = fakeDeps();
		const fired = await checkBudgetAlerts(h.db, deps);
		expect(fired).toBe(1);
		expect(sent).toHaveLength(1);
		expect(sent[0].title).toBe('Groceries budget exceeded');
		expect(sent[0].body).toContain('this week');
		expect(sent[0].tag).toBe(`budget-alert:${groceries}:2026-06-15`);

		const [log] = await h.db.select().from(budgetAlertLog);
		// The alert state lives on the week's first day, not the month — a
		// weekly cooldown can never be satisfied by a monthly key or vice versa.
		expect(log.periodKey).toBe('2026-06-15');
	});

	it('does not let weekly spend trip a monthly budget it fits inside', async () => {
		h = await makeTestDb();
		const ws = await seedWorkspace(h.db, { timezone: 'America/New_York' });
		const groceries = await ws.addCategory('Groceries');
		await setBudget(
			h.db,
			{ newId: () => crypto.randomUUID() },
			{
				workspaceId: ws.workspaceId,
				categoryId: groceries,
				amountMinor: 500_00n,
				effectiveFrom: '2026-06-01',
				period: 'month'
			}
		);
		await ws.addPurchase({
			categoryId: groceries,
			amountMinor: 110_00n,
			state: 'completed',
			completedAt: new Date('2026-06-16T15:00:00Z')
		});

		const { deps, sent } = fakeDeps();
		const fired = await checkBudgetAlerts(h.db, deps);
		expect(fired).toBe(0);
		expect(sent).toHaveLength(0);
	});

	it('still keys monthly alerts by month', async () => {
		h = await makeTestDb();
		const ws = await seedWorkspace(h.db, { timezone: 'America/New_York' });
		await setBudget(
			h.db,
			{ newId: () => crypto.randomUUID() },
			{
				workspaceId: ws.workspaceId,
				categoryId: null,
				amountMinor: 200_00n,
				effectiveFrom: '2026-06-01',
				period: 'month'
			}
		);
		await ws.addPurchase({
			amountMinor: 250_00n,
			state: 'completed',
			completedAt: new Date('2026-06-16T15:00:00Z')
		});

		const { deps, sent } = fakeDeps();
		const fired = await checkBudgetAlerts(h.db, deps);
		expect(fired).toBe(1);
		expect(sent[0].body).toContain('this month');
		const [log] = await h.db.select().from(budgetAlertLog);
		expect(log.periodKey).toBe('2026-06');
	});
});
