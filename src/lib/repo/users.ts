import { eq } from 'drizzle-orm';
import type { Db } from '$lib/db/types';
import { user } from '$lib/db/schema';
import type { IdGenerator } from '$lib/ports/id-generator';
import type { Clock } from '$lib/ports/clock';

/**
 * The identity an OIDC provider vouches for. Declared here, beside the only
 * thing that persists it, so the identity adapter depends on this contract
 * rather than the other way round — `$lib/server/auth/oidc` re-exports it.
 */
export interface OidcIdentity {
	subject: string;
	email: string;
	displayName: string;
	/** Profile picture URL from the IdP, if any. */
	picture?: string;
}

/**
 * First login creates an orphan user row and nothing else — no workspace,
 * no membership. Keyed on the OIDC `sub`; email and name are refreshed on
 * every login since they are mutable at the IdP.
 */
export async function upsertUserFromOidc(
	db: Db,
	deps: { clock: Clock; ids: IdGenerator },
	identity: OidcIdentity
): Promise<typeof user.$inferSelect> {
	const now = deps.clock.now();
	const rows = await db
		.insert(user)
		.values({
			id: deps.ids.newId(),
			oidcSubject: identity.subject,
			email: identity.email,
			displayName: identity.displayName,
			createdAt: now,
			lastLoginAt: now
		})
		.onConflictDoUpdate({
			target: user.oidcSubject,
			set: { email: identity.email, displayName: identity.displayName, lastLoginAt: now }
		})
		.returning();
	return rows[0];
}

export async function findUserById(db: Db, id: string) {
	const rows = await db.select().from(user).where(eq(user.id, id)).limit(1);
	return rows[0] ?? null;
}
