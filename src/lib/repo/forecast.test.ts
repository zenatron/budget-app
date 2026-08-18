import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb, seedWorkspace, type TestDb } from '$lib/repo/_test/harness';
import { forecastMonths } from '$lib/repo/forecast';

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

		const scope = { workspaceId: ws.workspaceId, viewerId: ws.ownerMemberId, timezone: ws.timezone };
		const r = await forecastMonths(h.db, scope, NOW, 3);

		expect(r.months.map((m) => `${m.month.y}-${m.month.m}`)).toEqual(['2026-7', '2026-8', '2026-9']);
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

		const scope = { workspaceId: ws.workspaceId, viewerId: ws.ownerMemberId, timezone: ws.timezone };
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

		const scope = { workspaceId: ws.workspaceId, viewerId: ws.ownerMemberId, timezone: ws.timezone };
		const r = await forecastMonths(h.db, scope, NOW, 2);
		// The bad bill is dropped; income still projects.
		expect(r.months[0].incomeMinor).toBe(500_000n);
		expect(r.months[0].billsMinor).toBe(0n);
	});
});
