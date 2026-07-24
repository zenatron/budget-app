import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { workspaceMember } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

/**
 * Like /settings/flag but for per-member boolean prefs — things that are a
 * personal display choice, not a workspace-wide setting. Whitelisted, same as
 * the workspace flag endpoint, so arbitrary columns can't be reached.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json().catch(() => null);
	const flag = body?.flag;
	const value = body?.value === true;

	const updates: Partial<typeof workspaceMember.$inferInsert> = {};
	if (flag === 'includeLedgerMovements') updates.includeLedgerMovements = value;
	else error(400, 'Unknown setting');

	await getDb()
		.update(workspaceMember)
		.set(updates)
		.where(eq(workspaceMember.id, locals.member!.id));
	return json({ ok: true });
};
