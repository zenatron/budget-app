import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '$lib/db/schema';
import type { Db } from '$lib/db/types';

/**
 * The demo's persistence adapter: Postgres compiled to WASM, in the tab.
 *
 * This is the whole reason the demo can reuse the real repo layer rather than
 * reimplement it. `$lib/repo/*` contains raw `sql` fragments, grouped
 * aggregates and the ledger's paging; against a hand-written object store those
 * would have to be rewritten in TypeScript, and the demo would then compute
 * *different numbers* than the app it is demonstrating. Against PGlite they run
 * unchanged. See `scripts/pglite-probe.ts` for the evidence.
 *
 * The cast is the one concession: drizzle types a postgres-js handle and a
 * PGlite handle as distinct `PgDatabase` instantiations even though the query
 * surface the repo layer uses is identical. Widening `Db` to their common
 * supertype would loosen it everywhere on the server to buy nothing there.
 */
let instance: Db | undefined;
let client: PGlite | undefined;

export interface DemoDbOptions {
	/** A pre-seeded data directory, as produced at build time. Without one the
	 *  database comes up empty and the caller has to seed it. */
	dataDir?: string;
}

export async function getDemoDb(opts: DemoDbOptions = {}): Promise<Db> {
	if (!instance) {
		client = opts.dataDir
			? await PGlite.create({ loadDataDir: await fetchDump(opts.dataDir) })
			: new PGlite();
		instance = drizzle(client, { schema }) as unknown as Db;
	}
	return instance;
}

/** The live client, for maintenance the ORM does not cover (dump/reset). */
export function getDemoClient(): PGlite | undefined {
	return client;
}

/** Drop the in-tab database so the next boot reloads the seeded snapshot. */
export async function resetDemoDb(): Promise<void> {
	await client?.close();
	client = undefined;
	instance = undefined;
}

async function fetchDump(url: string): Promise<Blob> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`demo: could not load seed data from ${url} (${res.status})`);
	return await res.blob();
}
