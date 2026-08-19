import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb, seedWorkspace, type TestDb } from '$lib/repo/_test/harness';
import { lastCategoryForMerchant } from '$lib/repo/purchases';

const NOW = new Date('2026-06-15T12:00:00Z');

let h: TestDb;
afterEach(() => h?.close());

describe('lastCategoryForMerchant seal filter', () => {
	it('does not suggest a category sourced only from a purchase sealed against the viewer', async () => {
		h = await makeTestDb();
		const ws = await seedWorkspace(h.db);
		const bob = await ws.addMember({ display: 'Bob' });
		const gifts = await ws.addCategory('Gifts');
		const acme = await ws.addMerchant({ name: 'Acme' });
		const future = new Date('2026-12-25T00:00:00Z');

		// The owner's only purchase at Acme is a gift, sealed from Bob.
		await ws.addPurchase({
			memberId: ws.ownerMemberId,
			categoryId: gifts,
			merchantId: acme,
			amountMinor: 5000n,
			state: 'completed',
			completedAt: NOW,
			sealedFromMemberIds: [bob],
			sealedUntil: future
		});

		// The owner is reminded of the category; Bob gets nothing, so typing "Acme"
		// cannot disclose that a purchase exists there at all.
		expect(await lastCategoryForMerchant(h.db, ws.workspaceId, 'acme', ws.ownerMemberId, NOW)).toBe(
			gifts
		);
		expect(await lastCategoryForMerchant(h.db, ws.workspaceId, 'acme', bob, NOW)).toBeNull();
	});

	it('still suggests from a purchase the viewer can see', async () => {
		h = await makeTestDb();
		const ws = await seedWorkspace(h.db);
		const bob = await ws.addMember();
		const groceries = await ws.addCategory('Groceries');
		const acme = await ws.addMerchant({ name: 'Acme' });

		await ws.addPurchase({
			categoryId: groceries,
			merchantId: acme,
			amountMinor: 3000n,
			state: 'completed',
			completedAt: NOW
		});

		expect(await lastCategoryForMerchant(h.db, ws.workspaceId, 'acme', bob, NOW)).toBe(groceries);
	});
});
