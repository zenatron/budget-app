import { asc, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { workspace, user as userTable } from '$lib/db/schema';
import { findWorkspaceForMember } from '$lib/repo/workspaces';
import type { Db } from '$lib/db/types';
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
 * demo there is no session to resolve: the visitor *is* the seeded owner. The
 * workspace half is still a real lookup though, because the seed holds more
 * than one and the URL decides which you are in — so it goes through the same
 * `findWorkspaceForMember` the hook uses, and a slug the visitor is not a
 * member of is a 404 here too.
 *
 * The shape it produces is identical, which is the point — every handler
 * downstream cannot tell which one built it.
 *
 * @param slug the workspace in the URL. Omitted only where there is no URL to
 *   read one from, in which case the visitor's first workspace stands in.
 */
export async function getDemoContext(base = '', slug?: string): Promise<WorkspaceContext> {
	// Deliberately *not* cached. `hooks.server.ts` re-reads the workspace and
	// member on every request, and settings write to exactly those two rows — a
	// cached context reports a stale copy, so a toggle saves and then appears to
	// do nothing. The database handle is the expensive part and `getDemoDb`
	// already single-flights it, so re-reading three rows per call is cheap.
	const db = await getDemoDb({ seedUrl: `${base}/${DEMO_SEED_URL}` });

	const home = await firstWorkspace(db);
	if (!home) throw new Error('demo: seed contains no workspace');

	// The account the demo is written from: the owner of the seed's first
	// workspace, and a member of every other one, so whichever workspace the URL
	// names resolves to the same person.
	const [u] = await db.select().from(userTable).where(eq(userTable.id, home.ownerUserId)).limit(1);
	if (!u) throw new Error('demo: seed workspace has no owning user');

	const hit = await findWorkspaceForMember(db, slug ?? home.slug, u.id);
	// 404 rather than falling back to another workspace: after a delete, the
	// honest answer to "/w/<gone>" is that it is gone, not somebody else's
	// ledger wearing its URL.
	if (!hit) error(404, 'Not found');

	return { db, deps: demoDeps(), user: u, workspace: hit.workspace, member: hit.member };
}

/**
 * The seed's oldest workspace: the demo's home, and the row the visitor's
 * identity hangs off.
 *
 * Ordered, because `limit(1)` without one is whatever Postgres hands back
 * first — and that is free to change after an UPDATE rewrites a row. An
 * unordered pick would move the demo's home, and with it who you are signed in
 * as, between one read and the next.
 */
async function firstWorkspace(db: Db) {
	const [ws] = await db.select().from(workspace).orderBy(asc(workspace.createdAt)).limit(1);
	return ws ?? null;
}

/**
 * Where the demo's root sends you, or null when there is nothing to open.
 *
 * The server answers this from the session's active workspace, falling back to
 * the first membership; there is no session here, so the seed's first workspace
 * is the whole answer. Null means the visitor has deleted everything, which the
 * landing page offers to undo.
 */
export async function findDemoEntrySlug(base = ''): Promise<string | null> {
	const db = await getDemoDb({ seedUrl: `${base}/${DEMO_SEED_URL}` });
	return (await firstWorkspace(db))?.slug ?? null;
}
