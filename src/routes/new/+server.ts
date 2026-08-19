import { redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { listWorkspacesForUser } from '$lib/repo/workspaces';
import type { RequestHandler } from './$types';

/**
 * The manifest shortcut for "New purchase" lands here, because a static
 * manifest cannot name a workspace slug. Same resolution as `/` (active
 * workspace, else the first membership) with one difference of opinion about
 * the destination: a shortcut that says "New purchase" owes the form, not the
 * ledger. Not logged in falls through to `/`, which renders the login screen;
 * no memberships means `/welcome`, exactly as `/`.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) redirect(303, '/');

	const memberships = await listWorkspacesForUser(getDb(), locals.user.id);
	if (memberships.length === 0) redirect(303, '/welcome');

	const active = memberships.find((m) => m.workspace.id === locals.session?.activeWorkspaceId);
	redirect(303, `/w/${(active ?? memberships[0]).workspace.slug}/purchases/new`);
};
