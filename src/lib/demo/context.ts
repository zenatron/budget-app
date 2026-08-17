import { and, asc, eq } from 'drizzle-orm';
import { workspace, workspaceMember, user as userTable } from '$lib/db/schema';
import type { WorkspaceContext } from '$lib/ports/context';
import { getDemoDb } from './db';
import { demoDeps } from './deps';

/** Where the build-time seed snapshot is served from, relative to the app base. */
export const DEMO_SEED_URL = 'demo-seed.tar.gz';

/**
 * The demo's stand-in for `hooks.server.ts`.
 *
 * On the server, resolving session → user → workspace membership is an
 * authorization decision, and the hook is the single place it is made. In the
 * demo there is no session and nothing to authorize: the visitor *is* the
 * seeded owner, and the only workspace is the seeded one. So this resolves the
 * same four values by reading them straight out of the seed.
 *
 * The shape it produces is identical, which is the point — every handler
 * downstream cannot tell which one built it.
 */
export async function getDemoContext(base = ''): Promise<WorkspaceContext> {
	// Deliberately *not* cached. `hooks.server.ts` re-reads the workspace and
	// member on every request, and settings write to exactly those two rows — a
	// cached context reports a stale copy, so a toggle saves and then appears to
	// do nothing. The database handle is the expensive part and `getDemoDb`
	// already single-flights it, so re-reading three rows per call is cheap.
	const db = await getDemoDb({ seedUrl: `${base}/${DEMO_SEED_URL}` });

	// Ordered, because `limit(1)` without one is whatever Postgres hands back
	// first — and that is free to change after an UPDATE rewrites a row. The
	// seed has three members, so an unordered pick silently switched *which
	// member you were* between a write and the next read: settings saved onto
	// one row and were read back from another, looking like nothing happened.
	const [ws] = await db.select().from(workspace).orderBy(asc(workspace.createdAt)).limit(1);
	if (!ws) throw new Error('demo: seed contains no workspace');

	// The visitor is the workspace's owner — the account the demo is written
	// from, and the one with nothing hidden from it.
	const [member] = await db
		.select()
		.from(workspaceMember)
		.where(and(eq(workspaceMember.workspaceId, ws.id), eq(workspaceMember.userId, ws.ownerUserId)))
		.limit(1);
	if (!member) throw new Error('demo: seed workspace has no owning member');

	const [u] = await db.select().from(userTable).where(eq(userTable.id, member.userId)).limit(1);
	if (!u) throw new Error('demo: seed member has no user');

	return { db, deps: demoDeps(), user: u, workspace: ws, member };
}
