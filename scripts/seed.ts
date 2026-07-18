/**
 * Dev seed: a demo workspace with two members and a few purchases, matching
 * the fake IdP identities in scripts/dev-oidc.ts (log in as alice or bob).
 *
 *   DATABASE_URL=postgres://root:mysecretpassword@localhost:5432/local bun scripts/seed.ts
 *
 * Idempotent-ish: refuses to run if the demo workspace already exists.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../src/lib/server/db/schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL');
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

const uuid = () => crypto.randomUUID();
const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

const existing = await db
	.select({ id: schema.workspace.id })
	.from(schema.workspace)
	.where(eq(schema.workspace.slug, 'demo'));
if (existing.length > 0) {
	console.log('demo workspace already exists — nothing to do');
	await client.end();
	process.exit(0);
}

async function upsertUser(sub: string, email: string, name: string): Promise<string> {
	const rows = await db
		.insert(schema.user)
		.values({
			id: uuid(),
			oidcSubject: sub,
			email,
			displayName: name,
			createdAt: now,
			lastLoginAt: null
		})
		.onConflictDoUpdate({ target: schema.user.oidcSubject, set: { email } })
		.returning({ id: schema.user.id });
	return rows[0].id;
}

const aliceId = await upsertUser('sub-alice-001', 'alice@example.com', 'Alice Test');
const bobId = await upsertUser('sub-bob-002', 'bob@example.com', 'Bob Test');

const wsId = uuid();
await db.insert(schema.workspace).values({
	id: wsId,
	slug: 'demo',
	name: 'Demo Household',
	ownerUserId: aliceId,
	currency: 'USD',
	timezone: 'America/New_York',
	createdAt: now
});

const aliceMember = uuid();
const bobMember = uuid();
await db.insert(schema.workspaceMember).values([
	{
		id: aliceMember,
		workspaceId: wsId,
		userId: aliceId,
		role: 'owner',
		approvalPolicy: { mode: 'none', routing: { mode: 'any_of', approver_ids: [] } },
		status: 'active',
		joinedAt: now
	},
	{
		id: bobMember,
		workspaceId: wsId,
		userId: bobId,
		role: 'member',
		approvalPolicy: {
			mode: 'threshold',
			threshold_minor: 5000,
			routing: { mode: 'any_of', approver_ids: [aliceMember] }
		},
		status: 'active',
		joinedAt: now
	}
]);

const cats = [
	{ name: 'Groceries', icon: '🛒', color: '#22c55e' },
	{ name: 'Dining', icon: '🍜', color: '#f97316' },
	{ name: 'Entertainment', icon: '🎬', color: '#ec4899' },
	{ name: 'Utilities', icon: '💡', color: '#64748b' }
].map((c) => ({ id: uuid(), workspaceId: wsId, ...c }));
await db.insert(schema.category).values(cats);

const purchases = [
	{ member: aliceMember, item: 'Weekly groceries', cat: 0, minor: 8734n, day: 6 },
	{ member: aliceMember, item: 'Takeout ramen', cat: 1, minor: 4250n, day: 4 },
	{ member: bobMember, item: 'Movie tickets', cat: 2, minor: 3200n, day: 3 },
	{ member: bobMember, item: 'Groceries top-up', cat: 0, minor: 2915n, day: 1 }
];
for (const p of purchases) {
	const id = uuid();
	const at = daysAgo(p.day);
	await db.insert(schema.purchase).values({
		id,
		workspaceId: wsId,
		memberId: p.member,
		state: 'completed',
		itemName: p.item,
		note: null,
		categoryId: cats[p.cat].id,
		merchantId: null,
		requestedAmountMinor: p.minor,
		approvedAmountMinor: null,
		finalAmountMinor: p.minor,
		currency: 'USD',
		sealedUntil: null,
		sealedFromMemberIds: [],
		requestedAt: null,
		decidedAt: null,
		completedAt: at,
		lastNudgedAt: null,
		nudgeCount: 0,
		recurringRuleId: null,
		parentPurchaseId: null,
		createdAt: at,
		updatedAt: at
	});
	await db.insert(schema.approvalEvent).values({
		id: uuid(),
		purchaseId: id,
		actorMemberId: p.member,
		fromState: 'draft',
		toState: 'completed',
		reason: 'seed',
		amountSnapshotMinor: p.minor,
		createdAt: at
	});
}

console.log('seeded: workspace "demo" with alice (owner) + bob (threshold $50) and 4 purchases');
await client.end();
