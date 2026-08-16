import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { isDiscretionMode } from '$lib/domain/visibility/discretion';
import { getDb } from '$lib/server/db';
import { workspaceMember } from '$lib/db/schema';
import type { RequestHandler } from './$types';

/**
 * The member-flag endpoint's sibling for prefs that aren't booleans — same
 * shape, same whitelist discipline: both the key and its value are checked
 * against the domain before anything reaches a column.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json().catch(() => null);
	const pref = body?.pref;
	const value = body?.value;

	const updates: Partial<typeof workspaceMember.$inferInsert> = {};
	if (pref === 'safeToSpendDisplay') {
		if (!isDiscretionMode(value)) error(400, 'Unknown display mode');
		updates.safeToSpendDisplay = value;
	} else error(400, 'Unknown setting');

	await getDb()
		.update(workspaceMember)
		.set(updates)
		.where(eq(workspaceMember.id, locals.member!.id));
	return json({ ok: true });
};
