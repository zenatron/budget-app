/**
 * Build the demo's seed snapshot.
 *
 * The demo ships a pre-seeded Postgres data directory rather than migrating and
 * seeding in the browser: the seed is ~18 months of activity, and replaying it
 * on every visit would cost seconds of spinner for a result that is identical
 * every time.
 *
 * The data itself comes from `scripts/seed-workspace.ts`, unchanged. That
 * script talks to a real Postgres over TCP, which PGlite cannot serve, so the
 * pipeline is: seed a throwaway database → pg_dump it → replay the dump into
 * PGlite → dump PGlite's data directory. The alternative was rewriting 1,494
 * lines of seed logic to take a `Db`, which would leave two seeders to keep in
 * agreement.
 *
 *   bun scripts/demo-seed.ts
 *
 * Requires a local Postgres (`bun run db:start`) and `pg_dump` on PATH.
 */
import { $ } from 'bun';
import { PGlite } from '@electric-sql/pglite';
import { writeFile, mkdir } from 'node:fs/promises';
import { runMigrations } from '../src/lib/server/db/migrate';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
// Deliberately NOT static/: everything there is copied into *every* build, and
// the production site has no use for 5 MB of demo data. `demo:build` copies it
// into build-demo/ after vite has run.
const OUT = `${ROOT}/demo-assets/demo-seed.tar.gz`;

const ADMIN_URL =
	process.env.DEMO_SEED_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
const SEED_DB = process.env.DEMO_SEED_DB ?? 'ledger_demo_seed';
const seedUrl = ADMIN_URL.replace(/\/[^/]*$/, `/${SEED_DB}`);

/**
 * pg_dump writes for psql, not for a server. Since 18.x it brackets the dump
 * with `\restrict` / `\unrestrict` meta-commands, which only psql understands —
 * PGlite sees a bare backslash and reports a syntax error. Nothing else in an
 * --inserts dump is client-side, so dropping meta-command lines is enough.
 */
function stripPsqlMeta(sql: string): string {
	return sql
		.split('\n')
		.filter((line) => !/^\\[a-z]/i.test(line))
		.join('\n');
}

async function main() {
	console.log(`1. recreating ${SEED_DB}…`);
	await $`psql ${ADMIN_URL} -v ON_ERROR_STOP=1 -c ${`drop database if exists ${SEED_DB}`}`.quiet();
	await $`psql ${ADMIN_URL} -v ON_ERROR_STOP=1 -c ${`create database ${SEED_DB}`}`.quiet();

	// seed-workspace.ts assumes the schema is already there.
	console.log('2. migrating…');
	await runMigrations(seedUrl, `${ROOT}/drizzle`);

	console.log('3. seeding…');
	await $`bun scripts/seed-workspace.ts --name ${'Demo Household'} --slug demo --reset --months 18`
		.env({ ...process.env, DATABASE_URL: seedUrl })
		.cwd(ROOT);

	console.log('4. dumping…');
	const dump =
		await $`pg_dump --no-owner --no-acl --no-comments --inserts --rows-per-insert=200 ${seedUrl}`.text();

	console.log('5. replaying into PGlite…');
	const client = new PGlite();
	await client.exec(stripPsqlMeta(dump));
	// pg_dump pins `search_path = ''` for its own session so every object it
	// creates is schema-qualified. That GUC is per-session and does not survive
	// into the snapshot, but it is still in force on *this* connection.
	await client.exec('SET search_path TO public;');

	const [{ n }] = (await client.query<{ n: number }>('select count(*)::int as n from purchase'))
		.rows;
	const [{ slug }] = (await client.query<{ slug: string }>('select slug from workspace limit 1'))
		.rows;
	console.log(`   ${n} purchases in workspace "${slug}"`);

	console.log('6. writing snapshot…');
	const blob = await client.dumpDataDir('gzip');
	await mkdir(`${ROOT}/demo-assets`, { recursive: true });
	await writeFile(OUT, Buffer.from(await blob.arrayBuffer()));
	await client.close();

	const mb = (Bun.file(OUT).size / 1024 / 1024).toFixed(2);
	console.log(`\ndemo seed written to demo-assets/demo-seed.tar.gz (${mb} MB)`);
}

/*
 * PGlite's embedded Postgres leaves a non-zero exit status behind (99) once it
 * has been instantiated, whether or not the client is closed — it is the wasm
 * runtime's own exit code surfacing, not a failure of this script. Left alone
 * it fails CI on a run that did everything correctly, so success exits
 * explicitly. Failures still go through the catch below.
 */
main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error('demo-seed failed:', e?.message ?? e);
		process.exit(1);
	});
