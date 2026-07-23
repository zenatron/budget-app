import { error, fail, redirect } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { purchase, workspace } from '$lib/server/db/schema';
import { listMembers } from '$lib/server/repo/workspaces';
import { visibleTo } from '$lib/server/repo/purchases';
import { deleteWorkspace } from '$lib/application/delete-workspace';
import { ACCENTS } from '$lib/accent';
import { systemClock } from '$lib/infra/time/system-clock';
import pkg from '../../../../package.json';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	// Reading the route param is what makes SvelteKit re-run this load when you
	// switch workspaces — a load that touches only `locals` (set per request by
	// hooks) declares no dependency on the URL, so client-side switching would
	// otherwise show the previous workspace's settings until a full reload.
	void params.workspace;
	const db = getDb();
	const now = systemClock.now();
	const members = await listMembers(db, locals.workspace!.id);
	const [pendingRow, confirmRow] = await Promise.all([
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(purchase)
			.where(
				and(
					eq(purchase.workspaceId, locals.workspace!.id),
					eq(purchase.state, 'pending_approval'),
					visibleTo(locals.member!.id, now)
				)
			),
		// Your own approved-but-unconfirmed purchases — the "confirm what you paid"
		// to-do, mirrored here so it's visible without opening the ledger.
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(purchase)
			.where(
				and(
					eq(purchase.workspaceId, locals.workspace!.id),
					eq(purchase.state, 'approved'),
					eq(purchase.memberId, locals.member!.id)
				)
			)
	]);
	return {
		pendingCount: pendingRow[0].count,
		confirmCount: confirmRow[0].count,
		bucketChargesSkipApproval: locals.workspace!.bucketChargesSkipApproval,
		billImportEnabled: locals.workspace!.billImportEnabled,
		intelligenceEnabled: locals.workspace!.intelligenceEnabled,
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
	},

	/**
	 * Delete the workspace and everything in it. Owner-only, irreversible, and
	 * gated on typing the exact name — the confirm dialog is the accident guard,
	 * this is the "did you mean *this* workspace" guard, since the word people
	 * type is far more specific than a yes/no they'll click through.
	 */
	deleteWorkspace: async ({ locals, request }) => {
		if (locals.member!.role !== 'owner') error(403, 'Only an owner can delete the workspace');
		const ws = locals.workspace!;
		const form = await request.formData();

		/*
		 * The form carries the id of the workspace it was *armed for*, frozen when
		 * the danger zone was opened. It must equal the workspace this request
		 * actually targets (from the URL). If they differ, the confirmation belongs
		 * to a workspace you were looking at earlier and has been carried into a
		 * different one — refuse rather than delete the wrong thing. This is the
		 * real guard against "delete a workspace while inside another": the delete
		 * is bound to its origin and the binding is enforced here, not in the UI.
		 */
		const armedId = String(form.get('workspaceId') ?? '');
		if (armedId !== ws.id) {
			return fail(400, {
				error: 'That confirmation was for a different workspace. Reopen it here and try again.'
			});
		}

		// Name match is the human "are you sure". Re-checked server-side because a
		// disabled button is a convenience a crafted request skips. Names are not
		// unique, which is exactly why the id binding above carries the real weight.
		const typed = String(form.get('confirmName') ?? '').trim();
		if (typed !== ws.name) {
			return fail(400, { error: `Type the workspace name exactly to confirm: ${ws.name}` });
		}

		await deleteWorkspace(getDb(), ws.id);
		// Back to the root, which re-picks a workspace or sends to /welcome. The
		// session's activeWorkspaceId was nulled inside the delete.
		redirect(303, '/');
	}
};
