import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/lib/server/db/schema';
import { eq } from 'drizzle-orm';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL');
const client = postgres(url);
const db = drizzle(client, { schema });

const slug = process.argv[2];
if (!slug) {
	console.error('Usage: bun scripts/add-member.ts <slug>');
	process.exit(1);
}

const users = await db.select().from(schema.user);
console.log('Users:');
for (const u of users) console.log(' ', u.id.slice(0, 8), u.email, u.displayName);

const [ws] = await db.select().from(schema.workspace).where(eq(schema.workspace.slug, slug));
if (!ws) {
	console.error(`No workspace with slug "${slug}"`);
	process.exit(1);
}

const members = await db
	.select()
	.from(schema.workspaceMember)
	.where(eq(schema.workspaceMember.workspaceId, ws.id));
console.log(
	'Current members:',
	members.map((m) => ({ userId: m.userId.slice(0, 8), role: m.role }))
);

// Add first user as owner if not already a member
const firstUser = users[0];
const already = members.find((m) => m.userId === firstUser.id);
if (already) {
	console.log(`"${firstUser.displayName}" is already a member (role: ${already.role}).`);
	await client.end();
	process.exit(0);
}

const memberId = crypto.randomUUID();
await db.insert(schema.workspaceMember).values({
	id: memberId,
	workspaceId: ws.id,
	userId: firstUser.id,
	role: 'owner',
	approvalPolicy: { mode: 'none', routing: { mode: 'any_of', approver_ids: [] } },
	status: 'active',
	joinedAt: new Date()
});
console.log(`Added "${firstUser.displayName}" as owner of "${ws.name}".`);
await client.end();
