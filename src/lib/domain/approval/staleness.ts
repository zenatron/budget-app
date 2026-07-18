/**
 * Staleness is derived, never stored. A pending request is stale when it has
 * waited longer than the workspace's stale_after window. Nudges escalate then
 * cap: first at the staleness threshold, then daily, at most MAX_NUDGES total.
 */

export const MAX_NUDGES = 5;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export function isStale(requestedAt: Date, staleAfterHours: number, now: Date): boolean {
	return now.getTime() - requestedAt.getTime() > staleAfterHours * HOUR_MS;
}

/**
 * When the next nudge for this pending request is due, or null when nudging
 * is exhausted. The sweep nudges when `now >= nextNudgeAt(...)`.
 */
export function nextNudgeAt(
	requestedAt: Date,
	staleAfterHours: number,
	lastNudgedAt: Date | null,
	nudgeCount: number
): Date | null {
	if (nudgeCount >= MAX_NUDGES) return null;
	if (lastNudgedAt === null) {
		return new Date(requestedAt.getTime() + staleAfterHours * HOUR_MS);
	}
	return new Date(lastNudgedAt.getTime() + DAY_MS);
}

/** Whole days a request has been waiting, for "waiting 3 days" copy. */
export function waitingDays(requestedAt: Date, now: Date): number {
	return Math.max(0, Math.floor((now.getTime() - requestedAt.getTime()) / DAY_MS));
}
