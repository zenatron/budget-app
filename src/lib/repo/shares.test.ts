import { describe, it, expect, afterEach } from 'vitest';
import { makeTestDb, seedWorkspace, type TestDb } from '$lib/repo/_test/harness';
import { createShare, loadShare, sweepExpiredShares, SHARE_TTL_MS } from '$lib/repo/shares';

let h: TestDb;
afterEach(() => h?.close());

// A mutable "now": expiry is a clock question, and this keeps every case on
// one timeline instead of sprinkling Date arithmetic through the assertions.
const base = new Date('2026-06-15T12:00:00Z');
let current = base;
const deps = {
	clock: { now: () => current },
	ids: { newId: () => crypto.randomUUID() }
};

describe('pending_share staging', () => {
	it('hands a share back to the member who shared it, within the hour', async () => {
		h = await makeTestDb();
		const ws = await seedWorkspace(h.db);
		current = base;

		const id = await createShare(h.db, deps, {
			workspaceId: ws.workspaceId,
			memberId: ws.ownerMemberId,
			blobId: 'ab'.repeat(32) + '.jpg',
			filename: 'receipt.jpg',
			contentType: 'image/jpeg',
			byteSize: 1024
		});

		expect(
			await loadShare(
				h.db,
				{ workspaceId: ws.workspaceId, memberId: ws.ownerMemberId },
				id,
				current
			)
		).toMatchObject({ blobId: 'ab'.repeat(32) + '.jpg', contentType: 'image/jpeg' });
	});

	it('is invisible to another member of the same workspace', async () => {
		h = await makeTestDb();
		const ws = await seedWorkspace(h.db);
		const bob = await ws.addMember();
		current = base;

		const id = await createShare(h.db, deps, {
			workspaceId: ws.workspaceId,
			memberId: ws.ownerMemberId,
			blobId: 'cd'.repeat(32) + '.png',
			filename: 'receipt.png',
			contentType: 'image/png',
			byteSize: 2048
		});

		// The id alone is not authorization — a share is pick-up only for its
		// owner, exactly as the blob routes are gated on purchase visibility.
		expect(
			await loadShare(h.db, { workspaceId: ws.workspaceId, memberId: bob }, id, current)
		).toBeNull();
	});

	it('treats a share past its TTL as absent', async () => {
		h = await makeTestDb();
		const ws = await seedWorkspace(h.db);
		current = base;
		const id = await createShare(h.db, deps, {
			workspaceId: ws.workspaceId,
			memberId: ws.ownerMemberId,
			blobId: 'ef'.repeat(32) + '.webp',
			filename: 'receipt.webp',
			contentType: 'image/webp',
			byteSize: 512
		});

		current = new Date(base.getTime() + SHARE_TTL_MS + 1);
		expect(
			await loadShare(
				h.db,
				{ workspaceId: ws.workspaceId, memberId: ws.ownerMemberId },
				id,
				current
			)
		).toBeNull();
	});

	it('sweeps expired rows and keeps fresh ones', async () => {
		h = await makeTestDb();
		const ws = await seedWorkspace(h.db);
		current = base;
		const fresh = await createShare(h.db, deps, {
			workspaceId: ws.workspaceId,
			memberId: ws.ownerMemberId,
			blobId: 'ab'.repeat(32) + '.jpg',
			filename: 'a.jpg',
			contentType: 'image/jpeg',
			byteSize: 1
		});
		current = new Date(base.getTime() - SHARE_TTL_MS - 60_000);
		await createShare(h.db, deps, {
			workspaceId: ws.workspaceId,
			memberId: ws.ownerMemberId,
			blobId: 'cd'.repeat(32) + '.jpg',
			filename: 'old.jpg',
			contentType: 'image/jpeg',
			byteSize: 1
		});

		current = base;
		expect(await sweepExpiredShares(h.db, current)).toBe(1);
		expect(
			await loadShare(
				h.db,
				{ workspaceId: ws.workspaceId, memberId: ws.ownerMemberId },
				fresh,
				current
			)
		).not.toBeNull();
	});
});
