import type { WorkspaceContext } from '$lib/ports/context';
import type { ActionEvent, LoadEvent } from '$lib/ports/handlers';
import { error, fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { workspace } from '$lib/db/schema';
import { ACCENTS } from '$lib/accent';

export async function load(ctx: WorkspaceContext, { params }: LoadEvent) {
	// Re-run this workspace-scoped load when the workspace in the URL changes;
	// a locals-only load declares no such dependency. See +layout.server.ts.
	void params.workspace;
	return {
		isOwner: ctx.member.role === 'owner',
		accentColor: ctx.workspace.accentColor
	};
}

export const actions = {
	/** The accent is workspace-scoped, so changing it is an owner-only setting. */
	accent: async (ctx: WorkspaceContext, { request }: ActionEvent) => {
		if (ctx.member.role !== 'owner') error(403, 'Only the owner can change the accent');
		const raw = String((await request.formData()).get('accentColor') ?? '');
		// Whitelist, not just a hex check: this value is interpolated into a
		// style attribute, so only the known palette may reach it.
		if (!(ACCENTS as readonly string[]).includes(raw)) {
			return fail(400, { error: 'Unknown accent color' });
		}
		await ctx.db
			.update(workspace)
			.set({ accentColor: raw })
			.where(eq(workspace.id, ctx.workspace.id));
		return { ok: true };
	}
};
