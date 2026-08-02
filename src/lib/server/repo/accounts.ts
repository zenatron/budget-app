/**
 * Cards and accounts. A small table with a narrow purpose: telling one card's
 * statement from another's during reconciliation, and remembering which card a
 * purchase was paid on once that has been settled.
 *
 * Nothing here touches money, and an account carries no credential — `last4` is
 * the label printed on the card, stored so two Visas can be told apart in a
 * picker.
 */

import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { account } from '$lib/server/db/schema';
import type { Clock } from '$lib/ports/clock';
import type { IdGenerator } from '$lib/ports/id-generator';

export type AccountRow = typeof account.$inferSelect;

/** Active accounts, oldest first — the order they were added is the order used. */
export async function listAccounts(db: Db, workspaceId: string): Promise<AccountRow[]> {
	return db
		.select()
		.from(account)
		.where(and(eq(account.workspaceId, workspaceId), eq(account.isArchived, false)))
		.orderBy(asc(account.createdAt));
}

export async function getAccount(
	db: Db,
	workspaceId: string,
	accountId: string
): Promise<AccountRow | null> {
	const [row] = await db
		.select()
		.from(account)
		.where(and(eq(account.workspaceId, workspaceId), eq(account.id, accountId)))
		.limit(1);
	return row ?? null;
}

export async function createAccount(
	db: Db,
	deps: { clock: Clock; ids: IdGenerator },
	workspaceId: string,
	input: { name: string; last4?: string | null; kind?: 'card' | 'bank' }
): Promise<string> {
	const id = deps.ids.newId();
	await db.insert(account).values({
		id,
		workspaceId,
		name: input.name.trim(),
		// Keep digits only, and only the last four of whatever was typed — people
		// paste a whole card number into a field like this.
		last4: input.last4 ? input.last4.replace(/\D/g, '').slice(-4) || null : null,
		kind: input.kind ?? 'card',
		isArchived: false,
		createdAt: deps.clock.now()
	});
	return id;
}

export async function updateAccount(
	db: Db,
	workspaceId: string,
	accountId: string,
	patch: { name?: string; last4?: string | null; kind?: 'card' | 'bank' }
): Promise<void> {
	const set: Partial<AccountRow> = {};
	if (patch.name !== undefined) set.name = patch.name.trim();
	if (patch.last4 !== undefined) {
		set.last4 = patch.last4 ? patch.last4.replace(/\D/g, '').slice(-4) || null : null;
	}
	if (patch.kind !== undefined) set.kind = patch.kind;
	if (Object.keys(set).length === 0) return;
	await db
		.update(account)
		.set(set)
		.where(and(eq(account.workspaceId, workspaceId), eq(account.id, accountId)));
}

/**
 * Archive rather than delete: purchases and imports reference an account, and a
 * card you closed is still the card last year's spending happened on.
 */
export async function archiveAccount(
	db: Db,
	workspaceId: string,
	accountId: string
): Promise<void> {
	await db
		.update(account)
		.set({ isArchived: true })
		.where(and(eq(account.workspaceId, workspaceId), eq(account.id, accountId)));
}

/** A short label for a picker or a ledger row: "Visa ·1234". */
export function accountLabel(a: Pick<AccountRow, 'name' | 'last4'>): string {
	return a.last4 ? `${a.name} ·${a.last4}` : a.name;
}
