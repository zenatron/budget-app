/**
 * The demo's stand-in for the session cookie.
 *
 * Signing out of the real app destroys the session row and clears the cookie,
 * and every `/w/` route then bounces you to the landing page. There is no
 * session here to destroy, but "Sign out" still has to mean something, so the
 * demo keeps the one bit the cookie's absence carries: whether you are signed
 * in. The generated route modules read it exactly where `hooks.server.ts`
 * reads the cookie.
 *
 * sessionStorage rather than localStorage, because that is the closest match
 * to a session cookie's lifetime: signing out sticks across a reload, and a
 * fresh tab starts signed in again rather than stranding somebody who
 * bookmarked the demo. The visitor's data is untouched either way — signing
 * out is not a reset, and "Reset demo" in the banner still is.
 */
const KEY = 'ledger-demo-signed-out';

/** Storage can throw in private modes, and a demo must not die over that. */
function store(): Storage | null {
	try {
		return typeof sessionStorage === 'undefined' ? null : sessionStorage;
	} catch {
		return null;
	}
}

export function isSignedOut(): boolean {
	return store()?.getItem(KEY) === '1';
}

export function signOut(): void {
	store()?.setItem(KEY, '1');
}

export function signIn(): void {
	store()?.removeItem(KEY);
}
