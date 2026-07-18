/**
 * In-memory sliding-window rate limiter. Single app container, 2–10 users —
 * a Map is the right amount of infrastructure. State resets on restart,
 * which is acceptable for abuse damping (not billing).
 */

const windows = new Map<string, number[]>();
let lastSweep = 0;

export function rateLimitOk(
	key: string,
	limit: number,
	windowMs: number,
	now = Date.now()
): boolean {
	// Occasionally drop expired keys so the map can't grow unbounded.
	if (now - lastSweep > 60_000) {
		lastSweep = now;
		for (const [k, hits] of windows) {
			if (hits.every((t) => now - t > 3_600_000)) windows.delete(k);
		}
	}
	const hits = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
	if (hits.length >= limit) {
		windows.set(key, hits);
		return false;
	}
	hits.push(now);
	windows.set(key, hits);
	return true;
}
