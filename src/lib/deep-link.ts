/**
 * Notification deep links.
 *
 * Push payloads carry a path, never an origin. The service worker resolves it
 * against the origin actually serving it, so a stale or default PUBLIC_ORIGIN
 * (it defaults to localhost) can't produce a notification that opens
 * http://localhost:3000 on someone's phone.
 *
 * Lives in $lib rather than inside service-worker.ts so it is unit-testable —
 * anything that decides what origin to navigate to deserves tests.
 */

export interface DeepLinkPayload {
	/** Preferred: a path such as /w/acme/purchases/123. */
	path?: string;
	/** Legacy payloads baked an absolute URL at send time. Only its path counts. */
	url?: string;
}

/**
 * Reduce a payload to a same-origin path. Absolute URLs are stripped to their
 * path — that repairs already-delivered notifications built against the wrong
 * origin, and stops a malformed payload from navigating off-site.
 */
export function resolveDeepLink(payload: DeepLinkPayload, origin: string): string {
	const raw = payload.path ?? payload.url ?? '/';
	try {
		const u = new URL(raw, origin);
		return u.pathname + u.search + u.hash;
	} catch {
		return '/';
	}
}
