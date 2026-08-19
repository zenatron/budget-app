import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb, seedWorkspace, type TestDb } from '$lib/repo/_test/harness';
import { setBudget, schedulableBudgetWeeks } from '$lib/repo/budgets';
import { eq } from 'drizzle-orm';
import { budget } from '$lib/db/schema';

let h: TestDb | undefined;
// This file has pure tests between DB tests, so the handle must be cleared on
// teardown — a stale pointer to an already-closed PGlite throws in the next
// afterEach rather than no-opping like the `h?.close()` in all-DB files.
afterEach(async () => {
	await h?.close();
	h = undefined;
});

const ids = { newId: () => crypto.randomUUID() };

// A Wednesday in New York, so the Monday-start week is unambiguous.
const TODAY = { y: 2026, m: 6, d: 17 };

async function rows() {
	return h!.db.select().from(budget).orderBy(budget.effectiveFrom);
}

describe('weekly budgets', () => {
	it('keeps weekly and monthly budgets for the same scope on separate timelines', async () => {
		h = await makeTestDb();
		const ws = await seedWorkspace(h.db, { timezone: 'America/New_York' });
		const groceries = await ws.addCategory('Groceries');

		await setBudget(h.db, ids, {
			workspaceId: ws.workspaceId,
			categoryId: groceries,
			amountMinor: 400_00n,
			effectiveFrom: '2026-06-01',
			period: 'month'
		});
		await setBudget(h.db, ids, {
			workspaceId: ws.workspaceId,
			categoryId: groceries,
			amountMinor: 100_00n,
			effectiveFrom: '2026-06-15',
			period: 'week'
		});

		const all = await rows();
		expect(all).toHaveLength(2);
		// The weekly line must not truncate the monthly one's open range: they
		// never see each other.
		const monthly = all.find((r) => r.period === 'month');
		const weekly = all.find((r) => r.period === 'week');
		expect(monthly?.effectiveTo).toBeNull();
		expect(weekly?.effectiveFrom).toBe('2026-06-15');
	});

	it('keeps the weekly timeline itself adjacent and non-overlapping', async () => {
		h = await makeTestDb();
		const ws = await seedWorkspace(h.db, { timezone: 'America/New_York' });

		await setBudget(h.db, ids, {
			workspaceId: ws.workspaceId,
			categoryId: null,
			amountMinor: 100_00n,
			effectiveFrom: '2026-06-15',
			period: 'week'
		});
		// A new cap two weeks out closes the first range.
		await setBudget(h.db, ids, {
			workspaceId: ws.workspaceId,
			categoryId: null,
			amountMinor: 80_00n,
			effectiveFrom: '2026-06-29',
			period: 'week'
		});

		const all = await rows();
		expect(all).toHaveLength(2);
		expect(all[0].effectiveTo).toBe('2026-06-29');
		expect(all[1].effectiveTo).toBeNull();
	});

	it('schedules weeks on the workspace week-start, starting at this week', async () => {
		const weeks = schedulableBudgetWeeks(TODAY, 1);
		// Wednesday Jun 17, Monday-start weeks: this week begins Jun 15.
		expect(weeks[0]).toBe('2026-06-15');
		expect(weeks[1]).toBe('2026-06-22');
		expect(weeks).toHaveLength(13); // this week through +12
	});

	it('replaces a weekly budget that starts the same week, not one that merely overlaps', async () => {
		h = await makeTestDb();
		const ws = await seedWorkspace(h.db, { timezone: 'America/New_York' });

		await setBudget(h.db, ids, {
			workspaceId: ws.workspaceId,
			categoryId: null,
			amountMinor: 100_00n,
			effectiveFrom: '2026-06-15',
			period: 'week'
		});
		await setBudget(h.db, ids, {
			workspaceId: ws.workspaceId,
			categoryId: null,
			amountMinor: 120_00n,
			effectiveFrom: '2026-06-15',
			period: 'week'
		});

		const all = await rows();
		expect(all).toHaveLength(1);
		expect(all[0].amountMinor).toBe(120_00n);
	});

	it('still writes a plain monthly budget exactly as before', async () => {
		h = await makeTestDb();
		const ws = await seedWorkspace(h.db);
		await setBudget(h.db, ids, {
			workspaceId: ws.workspaceId,
			categoryId: null,
			amountMinor: 500_00n,
			effectiveFrom: '2026-06-01',
			period: 'month'
		});
		const [row] = await h.db.select().from(budget).where(eq(budget.period, 'month'));
		expect(row.amountMinor).toBe(500_00n);
		expect(row.effectiveFrom).toBe('2026-06-01');
		expect(row.effectiveTo).toBeNull();
	});
});
