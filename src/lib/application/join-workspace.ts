import { and, eq } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { invite, workspace, workspaceMember } from '$lib/server/db/schema';
import { defaultApprovalPolicy } from '$lib/domain/approval/policy';
import type { Clock } from '$lib/ports/clock';
import type { IdGenerator } from '$lib/ports/id-generator';

export type JoinFailure = 'invalid_code' | 'expired' | 'already_used' | 'already_member';

export class JoinWorkspaceError extends Error {
	constructor(public readonly reason: JoinFailure) {
		super(`Cannot join workspace: ${reason}`);
		this.name = 'JoinWorkspaceError';
	}
}

export async function joinWorkspace(
	db: Db,
	deps: { clock: Clock; ids: IdGenerator },
	cmd: { userId: string; code: string }
): Promise<{ workspaceId: string; slug: string }> {
	const now = deps.clock.now();
	return db.transaction(async (tx) => {
		const inviteRows = await tx
			.select()
			.from(invite)
			.where(eq(invite.code, cmd.code))
			.for('update')
			.limit(1);
		const inv = inviteRows[0];
		if (!inv) throw new JoinWorkspaceError('invalid_code');
		if (inv.consumedAt) throw new JoinWorkspaceError('already_used');
		if (inv.expiresAt.getTime() <= now.getTime()) throw new JoinWorkspaceError('expired');

		const existing = await tx
			.select({ id: workspaceMember.id })
			.from(workspaceMember)
			.where(
				and(
					eq(workspaceMember.workspaceId, inv.workspaceId),
					eq(workspaceMember.userId, cmd.userId)
				)
			)
			.limit(1);
		if (existing.length > 0) throw new JoinWorkspaceError('already_member');

		await tx.insert(workspaceMember).values({
			id: deps.ids.newId(),
			workspaceId: inv.workspaceId,
			userId: cmd.userId,
			role: 'member',
			approvalPolicy: defaultApprovalPolicy(),
			status: 'active',
			joinedAt: now
		});
		await tx
			.update(invite)
			.set({ consumedBy: cmd.userId, consumedAt: now })
			.where(eq(invite.id, inv.id));

		const ws = await tx
			.select({ id: workspace.id, slug: workspace.slug })
			.from(workspace)
			.where(eq(workspace.id, inv.workspaceId))
			.limit(1);
		return { workspaceId: ws[0].id, slug: ws[0].slug };
	});
}
