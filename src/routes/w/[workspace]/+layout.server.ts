import { getDb } from '$lib/server/db';
import { listWorkspacesForUser } from '$lib/server/repo/workspaces';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	// hooks.server.ts guarantees user/workspace/member on /w/ routes.
	const { user, workspace, member } = locals;
	const memberships = await listWorkspacesForUser(getDb(), user!.id);
	return {
		user: { id: user!.id, displayName: user!.displayName },
		workspace: {
			id: workspace!.id,
			slug: workspace!.slug,
			name: workspace!.name,
			currency: workspace!.currency,
			timezone: workspace!.timezone,
			accentColor: workspace!.accentColor
		},
		member: { id: member!.id, role: member!.role },
		workspaces: memberships.map((m) => ({
			slug: m.workspace.slug,
			name: m.workspace.name,
			accentColor: m.workspace.accentColor
		}))
	};
};
