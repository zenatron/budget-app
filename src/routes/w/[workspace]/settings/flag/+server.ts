import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { workspace } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

/**
 * One tiny JSON endpoint behind every optimistic settings switch. It replaces
 * posting a form action over fetch, which leaned on SvelteKit's internal
 * action-response protocol and tripped up behind a proxy in production. A plain
 * JSON POST is exempt from form-origin CSRF checks and behaves identically in
 * dev and prod, so a flipped switch always lands.
 *
 * Owner-only, and the flag is whitelisted — this value decides a workspace-wide
 * setting, so only the known boolean columns may be reached.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (locals.member!.role !== 'owner') error(403, 'Only the owner can change this setting');

	const body = await request.json().catch(() => null);
	const flag = body?.flag;
	const value = body?.value === true;

	const updates: Partial<typeof workspace.$inferInsert> = {};
	if (flag === 'intelligenceEnabled') updates.intelligenceEnabled = value;
	else if (flag === 'billImportEnabled') updates.billImportEnabled = value;
	else if (flag === 'bucketChargesSkipApproval') updates.bucketChargesSkipApproval = value;
	else error(400, 'Unknown setting');

	await getDb().update(workspace).set(updates).where(eq(workspace.id, locals.workspace!.id));
	return json({ ok: true });
};
