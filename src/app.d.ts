import type { SessionRow, SessionUser } from '$lib/server/auth/session';
import type { MemberRow, WorkspaceRow } from '$lib/server/repo/workspaces';

declare global {
	namespace App {
		interface Locals {
			user: SessionUser | null;
			session: SessionRow | null;
			/** Set only on /w/[workspace] routes, after membership is verified. */
			workspace: WorkspaceRow | null;
			member: MemberRow | null;
		}
		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
