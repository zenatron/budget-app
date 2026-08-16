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

/**
 * IndexedDB, not localStorage: localStorage is synchronous, string-only and
 * capped around 5 MB, and the seeded database is bigger than that before anyone
 * adds a purchase. The name is versioned so a rebuilt seed doesn't try to open
 * a data directory written by an older schema.
 */
const IDB_NAME = 'ledger-demo-v1';
const DATA_DIR = `idb://${IDB_NAME}`;

/**
 * The *promise*, not just the resolved handle. SvelteKit runs a layout load and
 * its page load concurrently, so both reach this before either finishes — and
 * caching only the result let both proceed, opening two PGlite instances over
 * the same IndexedDB directory and downloading the seed twice.
 */
let opening: Promise<Db> | undefined;
let client: PGlite | undefined;

export interface DemoDbOptions {
	/** URL of the build-time seed snapshot, used on first visit only. */
	seedUrl?: string;
}

/**
 * Open the demo database, restoring the seed on first visit.
 *
 * Afterwards the IndexedDB copy is authoritative, so edits survive a reload and
 * the 5 MB snapshot is fetched once rather than on every page view.
 */
export function getDemoDb(opts: DemoDbOptions = {}): Promise<Db> {
	opening ??= (async () => {
		client = (await hasExistingDb())
			? await PGlite.create({ dataDir: DATA_DIR })
			: await PGlite.create({
					dataDir: DATA_DIR,
					loadDataDir: opts.seedUrl ? await fetchSeed(opts.seedUrl) : undefined
				});
		return drizzle(client, { schema }) as unknown as Db;
	})();
	return opening;
}

/** The live client, for maintenance the ORM does not cover. */
export function getDemoClient(): PGlite | undefined {
	return client;
}

/**
 * Throw away everything the visitor did and start again from the seed.
 *
 * Deleting the IndexedDB database is what makes the next `getDemoDb()` take the
 * seeding path; the caller reloads so no stale query results survive.
 */
export async function resetDemoDb(): Promise<void> {
	await client?.close();
	client = undefined;
	opening = undefined;
	await deleteIdb(IDB_NAME);
}

/**
 * Has this browser opened the demo before?
 *
 * `indexedDB.databases()` is unavailable on Firefox, so fall back to opening
 * the database and asking whether the open *created* it — an upgrade to
 * version 1 from nothing means it was not there.
 */
async function hasExistingDb(): Promise<boolean> {
	if (typeof indexedDB === 'undefined') return false;

	if (typeof indexedDB.databases === 'function') {
		try {
			const dbs = await indexedDB.databases();
			return dbs.some((d) => d.name === `/pglite/${IDB_NAME}` || d.name === IDB_NAME);
		} catch {
			/* fall through to the probe below */
		}
	}

	return await new Promise<boolean>((resolve) => {
		let existed = true;
		const req = indexedDB.open(`/pglite/${IDB_NAME}`);
		req.onupgradeneeded = () => {
			existed = false;
		};
		req.onsuccess = () => {
			req.result.close();
			// Opening it created an empty one; remove it so PGlite starts clean.
			if (!existed) void deleteIdb(IDB_NAME);
			resolve(existed);
		};
		req.onerror = () => resolve(false);
	});
}

function deleteIdb(name: string): Promise<void> {
	return new Promise((resolve) => {
		if (typeof indexedDB === 'undefined') return resolve();
		const req = indexedDB.deleteDatabase(`/pglite/${name}`);
		req.onsuccess = req.onerror = req.onblocked = () => resolve();
	});
}

async function fetchSeed(url: string): Promise<Blob> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`demo: could not load seed data from ${url} (${res.status})`);
	return await res.blob();
}
