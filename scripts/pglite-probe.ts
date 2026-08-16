/**
 * Does the repo layer run unchanged against PGlite?
 *
 * The demo build's whole premise is that `$lib/repo/*` is driver-agnostic: the
 * same Drizzle code that talks to postgres-js on the server talks to Postgres
 * compiled to WASM in the browser. This probe is what backs that claim, so it
 * targets the queries most likely to break — the raw `sql` fragments, the
 * timezone-dependent `to_char(... at time zone ...)`, the ledger's paging, and
 * safe-to-spend — rather than easy CRUD.
 *
 *   bun scripts/pglite-probe.ts
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { readdir, readFile } from 'node:fs/promises';
import * as schema from '../src/lib/db/schema';
import { monthPeriod } from '../src/lib/domain/analytics/period';
import * as analytics from '../src/lib/repo/analytics';
import * as buckets from '../src/lib/repo/buckets';
import * as ledger from '../src/lib/repo/ledger';
import * as forecast from '../src/lib/repo/forecast';
import { demoDeps } from '../src/lib/demo/deps';

/** A Request carrying a form body, the way SvelteKit hands one to an action. */
function formRequest(fields: Record<string, string>): Request {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.append(k, v);
	return new Request('http://demo.local/', { method: 'POST', body });
}

const MIGRATIONS = new URL('../drizzle', import.meta.url).pathname;

/**
 * Not drizzle's migrator. Several migrations carry multiple statements with no
 * `--> statement-breakpoint`, and PGlite's extended protocol accepts exactly one
 * statement per query — so the migrator fails on 0023 where postgres-js does
 * not. `exec()` is the simple protocol, which is what psql would use.
 */
export async function applyMigrations(client: PGlite): Promise<number> {
	const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
	for (const f of files) {
		await client.exec(await readFile(`${MIGRATIONS}/${f}`, 'utf8'));
	}
	return files.length;
}

async function main() {
	const client = new PGlite();
	const db = drizzle(client, { schema });

	const applied = await applyMigrations(client);
	console.log(`migrations       : ${applied} applied`);

	const now = new Date();
	const wsId = crypto.randomUUID();
	const userId = crypto.randomUUID();
	const memberId = crypto.randomUUID();
	const catId = crypto.randomUUID();
	const tz = 'America/New_York';

	await db.insert(schema.user).values({
		id: userId,
		oidcSubject: 'probe',
		email: 'probe@example.com',
		displayName: 'Probe',
		createdAt: now
	});
	await db.insert(schema.workspace).values({
		id: wsId,
		name: 'Probe WS',
		slug: 'probe-ws',
		ownerUserId: userId,
		currency: 'USD',
		timezone: tz,
		createdAt: now
	});
	await db.insert(schema.workspaceMember).values({
		id: memberId,
		workspaceId: wsId,
		userId,
		role: 'owner',
		approvalPolicy: { mode: 'none', routing: { mode: 'any_of', approver_ids: [] } },
		status: 'active',
		joinedAt: now
	});
	await db
		.insert(schema.category)
		.values({ id: catId, workspaceId: wsId, name: 'Groceries', createdAt: now });
	await db.insert(schema.purchase).values({
		id: crypto.randomUUID(),
		workspaceId: wsId,
		memberId,
		itemName: 'Probe purchase',
		categoryId: catId,
		requestedAmountMinor: 1234n,
		finalAmountMinor: 1234n,
		currency: 'USD',
		state: 'completed',
		completedAt: now,
		createdAt: now,
		updatedAt: now
	});

	const scope = { workspaceId: wsId, viewerId: memberId, timezone: tz };
	const period = monthPeriod({ y: now.getUTCFullYear(), m: now.getUTCMonth() + 1, d: 15 });

	const checks: [string, unknown][] = [
		['periodTotal', await analytics.periodTotal(db, scope, period, now)],
		['periodCount', await analytics.periodCount(db, scope, period, now)],
		['categoryBreakdown', (await analytics.categoryBreakdown(db, scope, period, now)).length],
		// to_char(... at time zone ...) — needs real tzdata inside the wasm build
		['dailyTrend', (await analytics.dailyTrend(db, scope, period, now)).size],
		['monthlyTrend', (await analytics.monthlyTrend(db, scope, period, now)).size],
		['listBuckets', (await buckets.listBuckets(db, wsId)).length],
		[
			'listLedger',
			(await ledger.listLedger(db, { workspaceId: wsId, viewerId: memberId }, now, {})).total
		],
		['safeToSpend', Object.keys(await forecast.safeToSpend(db, scope, now)).length]
	];
	for (const [name, value] of checks) {
		console.log(`${name.padEnd(17)}: ${value}`);
	}

	const total = await analytics.periodTotal(db, scope, period, now);
	if (total !== 1234n) throw new Error(`expected periodTotal 1234n, got ${total}`);

	// The real proof: the *route handler* — not just the repo layer — running
	// against PGlite with a browser-shaped context. This is the same module
	// +page.server.ts binds on the server; nothing about it is duplicated.
	const h = await import('../src/routes/w/[workspace]/recurring/handlers');
	const ctx = {
		db,
		deps: demoDeps(),
		user: { id: userId } as never,
		workspace: (await db.select().from(schema.workspace).limit(1))[0],
		member: (await db.select().from(schema.workspaceMember).limit(1))[0]
	};

	await h.actions.create(ctx, {
		request: formRequest({
			itemName: 'Streaming',
			amount: '12.99',
			freq: 'monthly',
			interval: '1',
			monthDay: '4',
			startDate: '2026-08-04'
		})
	});

	const page = await h.load(ctx, { params: { workspace: 'probe-ws' } });
	console.log('\nroute handler on PGlite:');
	console.log(`  rules            : ${page.rules.length}`);
	console.log(`  first rule       : ${page.rules[0]?.itemName} — ${page.rules[0]?.cadence}`);
	console.log(`  monthlyTotalMinor: ${page.monthlyTotalMinor}`);
	console.log(`  currency         : ${page.currency}`);

	if (page.rules.length !== 1) throw new Error('expected the created rule to come back');
	if (page.monthlyTotalMinor !== 1299n) {
		throw new Error(`expected monthlyTotalMinor 1299n, got ${page.monthlyTotalMinor}`);
	}

	console.log('\nPASS — repo layer AND route handler run unchanged on PGlite');
	await client.close();
}

main().catch((e) => {
	console.error('FAIL —', e?.message ?? e);
	if (e?.cause) console.error('CAUSE —', e.cause?.message ?? e.cause);
	process.exit(1);
});
