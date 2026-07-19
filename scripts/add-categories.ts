/**
 * Backfill DEFAULT_CATEGORIES into workspaces that already exist.
 *
 *   DATABASE_URL=postgres://... bun scripts/add-categories.ts
 *
 * Editing DEFAULT_CATEGORIES only affects workspaces created afterwards — the
 * list is copied in at creation, not read at query time. This catches the rest
 * up. Idempotent, and matches on name, so a category you renamed by hand won't
 * come back as a duplicate. Nothing is ever removed or renamed: a category that
 * has purchases against it is history, not configuration.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../src/lib/server/db/schema';
import { DEFAULT_CATEGORIES } from '../src/lib/application/create-workspace';
import { uuidv7 } from '../src/lib/infra/id/uuidv7';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL');
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

const workspaces = await db
	.select({ id: schema.workspace.id, slug: schema.workspace.slug })
	.from(schema.workspace);

let added = 0;
for (const ws of workspaces) {
	const existing = await db
		.select({ name: schema.category.name })
		.from(schema.category)
		.where(eq(schema.category.workspaceId, ws.id));
	const have = new Set(existing.map((c) => c.name.toLowerCase()));

	const missing = DEFAULT_CATEGORIES.filter((c) => !have.has(c.name.toLowerCase()));
	if (missing.length === 0) {
		console.log(`${ws.slug}: up to date`);
		continue;
	}

	await db.insert(schema.category).values(
		missing.map((c) => ({
			id: uuidv7.newId(),
			workspaceId: ws.id,
			name: c.name,
			icon: c.icon,
			color: c.color
		}))
	);
	added += missing.length;
	console.log(`${ws.slug}: added ${missing.map((c) => c.name).join(', ')}`);
}

console.log(
	`\nDone — ${added} categor${added === 1 ? 'y' : 'ies'} added across ${workspaces.length} workspace(s).`
);
await client.end();
