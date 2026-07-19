/**
 * Move workspaces off the retired bright accents onto their darker replacements.
 *
 *   DATABASE_URL=postgres://... bun scripts/restyle-accents.ts
 *
 * A workspace stores its accent as a literal hex, so changing ACCENTS only
 * affects what the picker offers — a workspace already on the old green keeps
 * rendering the old green, and the picker shows nothing selected because the
 * stored value matches no swatch. This catches them up. Idempotent.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from '../src/lib/server/db/schema';
import { RETIRED_ACCENTS } from '../src/lib/accent';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL');
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

const rows = await db
	.select({
		id: schema.workspace.id,
		slug: schema.workspace.slug,
		accent: schema.workspace.accentColor
	})
	.from(schema.workspace);

let moved = 0;
for (const ws of rows) {
	if (!ws.accent) continue;
	const next = RETIRED_ACCENTS[ws.accent.toUpperCase()];
	if (!next) continue;
	await db
		.update(schema.workspace)
		.set({ accentColor: next })
		.where(eq(schema.workspace.id, ws.id));
	console.log(`${ws.slug}: ${ws.accent} -> ${next}`);
	moved++;
}

console.log(`\nDone — ${moved} workspace(s) restyled of ${rows.length}.`);
await client.end();
