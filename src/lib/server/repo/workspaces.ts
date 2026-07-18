import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { category, user, workspace, workspaceMember } from '$lib/server/db/schema';

export type WorkspaceRow = typeof workspace.$inferSelect;
export type MemberRow = typeof workspaceMember.$inferSelect;

/** Workspace + the viewer's active membership, or null if not an active member. */
export async function findWorkspaceForMember(
	db: Db,
	slug: string,
	userId: string
): Promise<{ workspace: WorkspaceRow; member: MemberRow } | null> {
	const rows = await db
		.select({ workspace, member: workspaceMember })
		.from(workspace)
		.innerJoin(
			workspaceMember,
			and(eq(workspaceMember.workspaceId, workspace.id), eq(workspaceMember.userId, userId))
		)
		.where(and(eq(workspace.slug, slug), eq(workspaceMember.status, 'active')))
		.limit(1);
	return rows[0] ?? null;
}

/** All workspaces the user is an active member of (for the switcher). */
export async function listWorkspacesForUser(
	db: Db,
	userId: string
): Promise<{ workspace: WorkspaceRow; member: MemberRow }[]> {
	return db
		.select({ workspace, member: workspaceMember })
		.from(workspaceMember)
		.innerJoin(workspace, eq(workspaceMember.workspaceId, workspace.id))
		.where(and(eq(workspaceMember.userId, userId), eq(workspaceMember.status, 'active')))
		.orderBy(workspace.name);
}

export async function listCategories(db: Db, workspaceId: string) {
	return db
		.select()
		.from(category)
		.where(and(eq(category.workspaceId, workspaceId), eq(category.isArchived, false)))
		.orderBy(asc(category.name));
}

export async function listMembers(db: Db, workspaceId: string) {
	return db
		.select({ member: workspaceMember, user })
		.from(workspaceMember)
		.innerJoin(user, eq(workspaceMember.userId, user.id))
		.where(eq(workspaceMember.workspaceId, workspaceId))
		.orderBy(workspaceMember.joinedAt);
}
