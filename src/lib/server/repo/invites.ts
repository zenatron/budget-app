import { randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { invite } from '$lib/server/db/schema';
import type { Clock } from '$lib/ports/clock';
import type { IdGenerator } from '$lib/ports/id-generator';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Crockford base32: no 0/O or 1/I/L confusion when read aloud.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

function generateCode(): string {
	const bytes = randomBytes(10);
	let code = '';
	for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
	return code;
}

export async function createInvite(
	db: Db,
	deps: { clock: Clock; ids: IdGenerator },
	cmd: { workspaceId: string; createdByMemberId: string; ttlDays: number }
): Promise<typeof invite.$inferSelect> {
	const now = deps.clock.now();
	const ttlMs = cmd.ttlDays * 24 * 60 * 60 * 1000;
	const rows = await db
		.insert(invite)
		.values({
			id: deps.ids.newId(),
			workspaceId: cmd.workspaceId,
			code: generateCode(),
			createdBy: cmd.createdByMemberId,
			expiresAt: new Date(now.getTime() + ttlMs)
		})
		.returning();
	return rows[0];
}

/** Unconsumed, unexpired invites for a workspace. */
export async function listOpenInvites(db: Db, workspaceId: string, now: Date) {
	return db
		.select()
		.from(invite)
		.where(
			and(eq(invite.workspaceId, workspaceId), isNull(invite.consumedAt), gt(invite.expiresAt, now))
		)
		.orderBy(invite.expiresAt);
}
