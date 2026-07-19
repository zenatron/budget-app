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
	accentColor?: string | null;
}

/*
 * The categories every workspace starts with.
 *
 * Deliberately no "Misc": a purchase with no category already exists and
 * already has a name — analytics totals it as "Other". A Misc *row* would split
 * that one intent across two buckets that never merge in any breakdown, so you
 * would end up reading "Misc £120" and "Other £80" side by side.
 *
 * Each of these is something you would plausibly set a budget against, which is
 * the test for whether a category earns its place. Subscriptions is separate
 * from Entertainment because a streaming bill and a night out behave nothing
 * alike — one is fixed and recurring, the other discretionary — and the app has
 * a whole recurring-charges feature that had nowhere to put them.
 *
 * Adding to this list only affects NEW workspaces. Run scripts/add-categories.ts
 * to backfill the ones that already exist.
 */
const DEFAULT_CATEGORIES: { name: string; icon: string; color: string }[] = [
	{ name: 'Groceries', icon: '🛒', color: '#22c55e' },
	{ name: 'Dining', icon: '🍜', color: '#f97316' },
	{ name: 'Transport', icon: '🚆', color: '#0ea5e9' },
	{ name: 'Home', icon: '🏠', color: '#8b5cf6' },
	{ name: 'Health', icon: '💊', color: '#ef4444' },
	{ name: 'Entertainment', icon: '🎬', color: '#ec4899' },
	{ name: 'Subscriptions', icon: '🔁', color: '#6366f1' },
	{ name: 'Shopping', icon: '🛍️', color: '#eab308' },
	{ name: 'Personal care', icon: '🧴', color: '#d946ef' },
	{ name: 'Pets', icon: '🐾', color: '#b45309' },
	{ name: 'Travel', icon: '✈️', color: '#14b8a6' },
	{ name: 'Utilities', icon: '💡', color: '#64748b' },
	{ name: 'Gifts', icon: '🎁', color: '#f43f5e' }
];

export { DEFAULT_CATEGORIES };

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
			accentColor: cmd.accentColor ?? null,
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
