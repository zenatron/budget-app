import { eq } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { category, workspace, workspaceMember } from '$lib/server/db/schema';
import { defaultApprovalPolicy } from '$lib/domain/approval/policy';
import type { Clock } from '$lib/ports/clock';
import type { IdGenerator } from '$lib/ports/id-generator';

export interface CreateWorkspaceCmd {
	userId: string;
	name: string;
	currency: string;
	timezone: string;
}

const DEFAULT_CATEGORIES: { name: string; icon: string; color: string }[] = [
	{ name: 'Groceries', icon: '🛒', color: '#22c55e' },
	{ name: 'Dining', icon: '🍜', color: '#f97316' },
	{ name: 'Transport', icon: '🚆', color: '#0ea5e9' },
	{ name: 'Home', icon: '🏠', color: '#8b5cf6' },
	{ name: 'Health', icon: '💊', color: '#ef4444' },
	{ name: 'Entertainment', icon: '🎬', color: '#ec4899' },
	{ name: 'Shopping', icon: '🛍️', color: '#eab308' },
	{ name: 'Travel', icon: '✈️', color: '#14b8a6' },
	{ name: 'Utilities', icon: '💡', color: '#64748b' },
	{ name: 'Gifts', icon: '🎁', color: '#f43f5e' }
];

export function slugify(name: string): string {
	return (
		name
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[̀-ͯ]/g, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 40) || 'workspace'
	);
}

function randomSuffix(): string {
	return Math.random().toString(36).slice(2, 6);
}

export async function createWorkspace(
	db: Db,
	deps: { clock: Clock; ids: IdGenerator },
	cmd: CreateWorkspaceCmd
): Promise<{ workspaceId: string; slug: string }> {
	const now = deps.clock.now();
	const base = slugify(cmd.name);

	let slug = base;
	const taken = await db
		.select({ slug: workspace.slug })
		.from(workspace)
		.where(eq(workspace.slug, base));
	if (taken.length > 0) slug = `${base}-${randomSuffix()}`;

	const workspaceId = deps.ids.newId();
	await db.transaction(async (tx) => {
		await tx.insert(workspace).values({
			id: workspaceId,
			slug,
			name: cmd.name,
			ownerUserId: cmd.userId,
			currency: cmd.currency,
			timezone: cmd.timezone,
			createdAt: now
		});
		await tx.insert(workspaceMember).values({
			id: deps.ids.newId(),
			workspaceId,
			userId: cmd.userId,
			role: 'owner',
			approvalPolicy: defaultApprovalPolicy(),
			status: 'active',
			joinedAt: now
		});
		await tx.insert(category).values(
			DEFAULT_CATEGORIES.map((c) => ({
				id: deps.ids.newId(),
				workspaceId,
				name: c.name,
				icon: c.icon,
				color: c.color
			}))
		);
	});
	return { workspaceId, slug };
}
