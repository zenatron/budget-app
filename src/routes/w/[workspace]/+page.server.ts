import { error, fail } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { purchase, workspace } from '$lib/server/db/schema';
import { listMembers } from '$lib/server/repo/workspaces';
import { visibleTo } from '$lib/server/repo/purchases';
import { ACCENTS } from '$lib/accent';
import { systemClock } from '$lib/infra/time/system-clock';
import pkg from '../../../../package.json';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const db = getDb();
	const now = systemClock.now();
	const members = await listMembers(db, locals.workspace!.id);
	const [pendingRow] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(purchase)
		.where(
			and(
				eq(purchase.workspaceId, locals.workspace!.id),
				eq(purchase.state, 'pending_approval'),
				visibleTo(locals.member!.id, now)
			)
		);
	return {
		pendingCount: pendingRow.count,
		bucketChargesSkipApproval: locals.workspace!.bucketChargesSkipApproval,
		billImportEnabled: locals.workspace!.billImportEnabled,
		accentColor: locals.workspace!.accentColor,
		// Just the headline for the Members row. The list, the policies and the
		// invites all live on settings/members now, which loads its own.
		memberCount: members.length,
		version: pkg.version
	};
};

export const actions: Actions = {
	bucketSkipApproval: async ({ locals, request }) => {
		if (locals.member!.role !== 'owner') error(403, 'Only the owner can change this setting');
		const value = (await request.formData()).get('enabled') === 'true';
		await getDb()
			.update(workspace)
			.set({ bucketChargesSkipApproval: value })
			.where(eq(workspace.id, locals.workspace!.id));
		return { ok: true };
	},

	billImport: async ({ locals, request }) => {
		if (locals.member!.role !== 'owner') error(403, 'Only the owner can change this setting');
		const value = (await request.formData()).get('enabled') === 'true';
		await getDb()
			.update(workspace)
			.set({ billImportEnabled: value })
			.where(eq(workspace.id, locals.workspace!.id));
		return { ok: true };
	},

	/** The accent is workspace-scoped, so changing it is an owner-only setting. */
	accent: async ({ locals, request }) => {
		if (locals.member!.role !== 'owner') error(403, 'Only the owner can change the accent');
		const raw = String((await request.formData()).get('accentColor') ?? '');
		// Whitelist, not just a hex check: this value is interpolated into a
		// style attribute, so only the known palette may reach it.
		if (!(ACCENTS as readonly string[]).includes(raw)) {
			return fail(400, { error: 'Unknown accent color' });
		}
		await getDb()
			.update(workspace)
			.set({ accentColor: raw })
			.where(eq(workspace.id, locals.workspace!.id));
		return { ok: true };
	}
};
