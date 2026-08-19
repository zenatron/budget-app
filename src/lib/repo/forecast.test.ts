import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb, seedWorkspace, type TestDb } from '$lib/repo/_test/harness';
import { forecastMonths, safeToSpend } from '$lib/repo/forecast';

const NOW = new Date('2026-06-15T12:00:00Z'); // → firstMonth is July 2026
const rr = (day: number) => `DTSTART=2026-01-01;FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=${day}`;

let h: TestDb;
afterEach(() => h?.close());

describe('forecastMonths', () => {
	it('projects free cash for the months after this one from recurring facts', async () => {
		h = await makeTestDb();
		const ws = await seedWorkspace(h.db, { timezone: 'America/New_York' });
		await ws.addIncome({ amountMinor: 500_000n, receivedAt: NOW, rrule: rr(1) }); // $5,000/mo
		await ws.addRecurring({ amountMinor: 200_000n, rrule: rr(5) }); //               $2,000/mo bill
		await ws.addBucket({ amountMinor: 50_000n, rrule: rr(15) }); //                    $500/mo saved

		const scope = {
			workspaceId: ws.workspaceId,
			viewerId: ws.ownerMemberId,
			timezone: ws.timezone
		};
		const r = await forecastMonths(h.db, scope, NOW, 3);

		expect(r.months.map((m) => `${m.month.y}-${m.month.m}`)).toEqual([
			'2026-7',
			'2026-8',
			'2026-9'
		]);
		for (const m of r.months) expect(m.freeMinor).toBe(250_000n); // 5000 - 2000 - 500
		expect(r.clearMonths).toBe(3);
		expect(r.firstShortMonth).toBeNull();
	});

	it('counts a one-off future income only in its month, and ignores this month / the past', async () => {
		h = await makeTestDb();
		const ws = await seedWorkspace(h.db, { timezone: 'America/New_York' });
		await ws.addIncome({ amountMinor: 500_000n, receivedAt: NOW, rrule: rr(1) });
		// A bonus in August (inside the horizon), a raise last month (ignored),
		// and something this month (Safe to Spend's, not the runway's).
		await ws.addIncome({ amountMinor: 100_000n, receivedAt: new Date('2026-08-20T12:00:00Z') });
		await ws.addIncome({ amountMinor: 999_999n, receivedAt: new Date('2026-05-20T12:00:00Z') });
		await ws.addIncome({ amountMinor: 888_888n, receivedAt: new Date('2026-06-20T12:00:00Z') });

		const scope = {
			workspaceId: ws.workspaceId,
			viewerId: ws.ownerMemberId,
			timezone: ws.timezone
		};
		const r = await forecastMonths(h.db, scope, NOW, 3);
		expect(r.months[0].incomeMinor).toBe(500_000n); // Jul
		expect(r.months[1].incomeMinor).toBe(600_000n); // Aug +$1,000 bonus
		expect(r.months[2].incomeMinor).toBe(500_000n); // Sep
	});

	it('skips a malformed rule instead of throwing', async () => {
		h = await makeTestDb();
		const ws = await seedWorkspace(h.db);
		await ws.addIncome({ amountMinor: 500_000n, receivedAt: NOW, rrule: rr(1) });
		await ws.addRecurring({ amountMinor: 200_000n, rrule: 'FREQ=MONTHLY;BYMONTHDAY=5' }); // no DTSTART

		const scope = {
			workspaceId: ws.workspaceId,
			viewerId: ws.ownerMemberId,
			timezone: ws.timezone
		};
		const r = await forecastMonths(h.db, scope, NOW, 2);
		// The bad bill is dropped; income still projects.
		expect(r.months[0].incomeMinor).toBe(500_000n);
		expect(r.months[0].billsMinor).toBe(0n);
	});

	it('flags the projected months a confirm-at-price bill lands in', async () => {
		h = await makeTestDb();
		const ws = await seedWorkspace(h.db, { timezone: 'America/New_York' });
		await ws.addIncome({ amountMinor: 500_000n, receivedAt: NOW, rrule: rr(1) });
		await ws.addRecurring({ amountMinor: 200_000n, rrule: rr(5), autoComplete: true });
		// The phone bill, recorded at last month's price until someone confirms.
		await ws.addRecurring({ amountMinor: 150_000n, rrule: rr(20), autoComplete: false });

		const scope = {
			workspaceId: ws.workspaceId,
			viewerId: ws.ownerMemberId,
			timezone: ws.timezone
		};
		const r = await forecastMonths(h.db, scope, NOW, 2);
		// Both bills land every projected month; the variable one makes each an
		// estimate, the same signal this month's dotted figure comes from.
		expect(r.months.every((m) => m.estimated)).toBe(true);
		expect(r.months[0].billsMinor).toBe(350_000n);
	});

	it('leaves projected months clean when every bill records its own amount', async () => {
		h = await makeTestDb();
		const ws = await seedWorkspace(h.db, { timezone: 'America/New_York' });
		await ws.addIncome({ amountMinor: 500_000n, receivedAt: NOW, rrule: rr(1) });
		await ws.addRecurring({ amountMinor: 200_000n, rrule: rr(5), autoComplete: true });

		const scope = {
			workspaceId: ws.workspaceId,
			viewerId: ws.ownerMemberId,
			timezone: ws.timezone
		};
		const r = await forecastMonths(h.db, scope, NOW, 2);
		expect(r.months.every((m) => !m.estimated)).toBe(true);
	});
});

describe('safeToSpend', () => {
	const scopeFor = (ws: Awaited<ReturnType<typeof seedWorkspace>>, viewerId: string) => ({
		workspaceId: ws.workspaceId,
		viewerId,
		timezone: ws.timezone
	});

	it('seals arithmetically: a concealed member’s free cash does not know the gift exists', async () => {
		h = await makeTestDb();
		const ws = await seedWorkspace(h.db, { timezone: 'America/New_York' });
		const bob = await ws.addMember({ display: 'Bob' });
		await ws.addIncome({ amountMinor: 500_000n, receivedAt: NOW, rrule: rr(1) });
		// A gift completed this month, sealed from Bob until Christmas.
		await ws.addPurchase({
			amountMinor: 120_000n,
			state: 'completed',
			completedAt: new Date('2026-06-10T12:00:00Z'),
			sealedFromMemberIds: [bob],
			sealedUntil: new Date('2026-12-25T00:00:00Z')
		});

		const owner = await safeToSpend(h.db, scopeFor(ws, ws.ownerMemberId), NOW);
		const concealed = await safeToSpend(h.db, scopeFor(ws, bob), NOW);

		expect(owner.breakdown.cashSpentMinor).toBe(120_000n);
		expect(concealed.breakdown.cashSpentMinor).toBe(0n);
		// The concealment is recomputation, not a hidden row: Bob's number is
		// the gift higher, exactly as if it had never been bought.
		expect(concealed.freeMinor - owner.freeMinor).toBe(120_000n);
	});

	it('nets a refund out of the spent figure', async () => {
		h = await makeTestDb();
		const ws = await seedWorkspace(h.db, { timezone: 'America/New_York' });
		const parent = await ws.addPurchase({
			amountMinor: 100_000n,
			state: 'completed',
			completedAt: new Date('2026-06-10T12:00:00Z')
		});
		// The refund is its own row, negative, pointing back at the parent.
		await ws.addPurchase({
			amountMinor: -30_000n,
			state: 'refunded',
			completedAt: new Date('2026-06-12T12:00:00Z'),
			parentPurchaseId: parent
		});

		const sts = await safeToSpend(h.db, scopeFor(ws, ws.ownerMemberId), NOW);
		expect(sts.breakdown.cashSpentMinor).toBe(70_000n);
	});
});
