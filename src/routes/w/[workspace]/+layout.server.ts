import { getDb } from '$lib/server/db';
import { listWorkspacesForUser } from '$lib/server/repo/workspaces';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, params }) => {
	// hooks.server.ts guarantees user/workspace/member on /w/ routes.
	const { user, workspace, member } = locals;
	const memberships = await listWorkspacesForUser(getDb(), user!.id);
	return {
		user: { id: user!.id, displayName: user!.displayName },
		workspace: {
			id: workspace!.id,
			// From params, not locals: reading the route param is what tells
			// SvelteKit this load depends on the workspace in the URL. A load that
			// touches only `locals` declares no such dependency, so switching
			// workspace client-side reuses the previous one's cached data — the
			// whole page shows the old workspace until a full reload. Same value
			// either way (hooks resolves the workspace from this slug).
			slug: params.workspace,
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
