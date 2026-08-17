import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '$lib/db/schema';
import type { Db } from '$lib/db/types';
import { getEnv } from '$lib/server/env';

export type { Db };

let instance: Db | undefined;

/** Lazy so importing route modules during `vite build` needs no DATABASE_URL. */
export function getDb(): Db {
	if (!instance) {
		instance = drizzle(postgres(getEnv().DATABASE_URL), { schema });
	}
	return instance;
}
