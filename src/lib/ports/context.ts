import type { Db } from '$lib/db/types';
import type { MemberRow, WorkspaceRow } from '$lib/repo/workspaces';
import type { UserRow } from '$lib/repo/users';
import type { AppDeps } from './deps';

/**
 * Everything a request-handling body needs, handed to it rather than fetched
 * by it.
 *
 * Route handlers currently open with `getDb()` and a hand-rolled
 * `{ clock: systemClock, ids: uuidv7 }`. That is a service locator: it reaches
 * out for a specific implementation, which is what pins those handlers to a
 * server. Taking this as a parameter is what lets the same handler body run
 * against postgres in production and against an in-browser database in the
 * demo build, with no branch inside the handler.
 *
 * Nothing here is server-only, so this type is importable from client code.
 */
export interface AppContext {
	db: Db;
	deps: AppDeps;
	user: UserRow;
}

/** A context on a `/w/[workspace]` route, where membership has been verified
 *  and `workspace`/`member` are therefore known to be present. */
export interface WorkspaceContext extends AppContext {
	workspace: WorkspaceRow;
	member: MemberRow;
}
