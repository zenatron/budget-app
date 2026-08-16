import { eq } from 'drizzle-orm';
import { workspace, workspaceMember, user as userTable } from '$lib/db/schema';
import type { WorkspaceContext } from '$lib/ports/context';
import { getDemoDb } from './db';
import { demoDeps } from './deps';

/** Where the build-time seed snapshot is served from, relative to the app base. */
export const DEMO_SEED_URL = 'demo-seed.tar.gz';

let cached: WorkspaceContext | undefined;

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
	if (cached) return cached;

	const db = await getDemoDb({ dataDir: `${base}/${DEMO_SEED_URL}` });

	const [ws] = await db.select().from(workspace).limit(1);
	if (!ws) throw new Error('demo: seed contains no workspace');

	const [member] = await db
		.select()
		.from(workspaceMember)
		.where(eq(workspaceMember.workspaceId, ws.id))
		.limit(1);
	if (!member) throw new Error('demo: seed workspace has no members');

	const [u] = await db.select().from(userTable).where(eq(userTable.id, member.userId)).limit(1);
	if (!u) throw new Error('demo: seed member has no user');

	cached = { db, deps: demoDeps(), user: u, workspace: ws, member };
	return cached;
}

/** Forget the resolved context, so the next load re-reads a reset database. */
export function clearDemoContext(): void {
	cached = undefined;
}
