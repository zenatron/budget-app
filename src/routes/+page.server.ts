import { redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { listWorkspacesForUser } from '$lib/server/repo/workspaces';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return {}; // render the login screen

	const memberships = await listWorkspacesForUser(getDb(), locals.user.id);
	if (memberships.length === 0) redirect(303, '/welcome');

	const active = memberships.find((m) => m.workspace.id === locals.session?.activeWorkspaceId);
	redirect(303, `/w/${(active ?? memberships[0]).workspace.slug}`);
};
