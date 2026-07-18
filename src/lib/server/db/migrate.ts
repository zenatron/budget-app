import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

// Arbitrary app-wide lock key; makes concurrent boots single-flight.
const MIGRATION_LOCK_KEY = 727_370;

export async function runMigrations(databaseUrl: string, migrationsFolder: string): Promise<void> {
	const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
	try {
		await client`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
		try {
			await migrate(drizzle(client), { migrationsFolder });
		} finally {
			await client`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
		}
	} finally {
		await client.end();
	}
}
