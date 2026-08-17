import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from './schema';

/**
 * The handle every repo and use case takes as its first argument.
 *
 * This is the persistence port: it names the *shape* of a database, not a
 * connection to one. Building an actual handle is an adapter's job —
 * `$lib/server/db` binds it to postgres-js over a TCP connection, and nothing
 * stops another adapter from binding it elsewhere.
 *
 * Type-only, so importing it pulls no driver into any bundle.
 */
export type Db = PostgresJsDatabase<typeof schema>;
