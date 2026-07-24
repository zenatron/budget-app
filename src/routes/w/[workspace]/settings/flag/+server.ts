import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { workspace } from '$lib/server/db/schema';
import { getEnv } from '$lib/server/env';
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
	else if (flag === 'keepStatementFiles') updates.keepStatementFiles = value;
	else if (flag === 'safeToSpendAlertsEnabled') updates.safeToSpendAlertsEnabled = value;
	else if (flag === 'barcodeEnabled') {
		if (value && !getEnv().BARCODE_LOOKUP_URL) {
			error(403, 'Barcode scanning requires BARCODE_LOOKUP_URL to be set in the environment');
		}
		updates.barcodeEnabled = value;
	} else if (flag === 'uniqueCategories') updates.uniqueCategories = value;
	else error(400, 'Unknown setting');

	await getDb().update(workspace).set(updates).where(eq(workspace.id, locals.workspace!.id));
	return json({ ok: true });
};
