import { isValidCoords } from '$lib/domain/location/coords';
import type { Geocoder, GeocodeResult } from '$lib/ports/geocoder';

/**
 * Nominatim-compatible forward geocoding.
 *
 * Two things this adapter takes seriously, both from the public instance's
 * usage policy: an identifiable `User-Agent` (anonymous clients are blocked
 * outright), and **at most one request per second**. The second is enforced
 * here rather than left to callers, because the consequence of getting it wrong
 * is the whole deployment's IP being banned — a failure mode that outlives the
 * request that caused it. The caller *also* debounces, and the two are
 * belt-and-braces on purpose.
 *
 * Nothing here throws. Every failure resolves to `[]`, per the port's contract.
 */

const MIN_INTERVAL_MS = 1000;
const TIMEOUT_MS = 5000;

interface NominatimRow {
	lat?: string;
	lon?: string;
	display_name?: string;
	name?: string;
}

export function nominatimGeocoder(cfg: { endpoint: string; email?: string }): Geocoder {
	/*
	 * Per-instance, and `getGeocoder` memoizes the instance so there is exactly
	 * one per process — that memo is what makes this gate real. Building a fresh
	 * adapter per HTTP request gave every request its own allowance, which is
	 * indistinguishable from having no gate at all.
	 */
	let nextAllowedAt = 0;

	return {
		available: true,

		describe: () => ({ kind: 'nominatim', endpoint: cfg.endpoint }),

		async search(query, limit = 5): Promise<GeocodeResult[]> {
			const q = query.trim();
			// Two characters cannot identify a place, and asking wastes a request
			// against a quota that is not ours.
			if (q.length < 3) return [];

			const now = Date.now();
			if (now < nextAllowedAt) return [];
			nextAllowedAt = now + MIN_INTERVAL_MS;

			try {
				const url = new URL('/search', cfg.endpoint);
				url.searchParams.set('q', q);
				url.searchParams.set('format', 'jsonv2');
				url.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 10)));
				url.searchParams.set('addressdetails', '0');
				if (cfg.email) url.searchParams.set('email', cfg.email);

				const res = await fetch(url, {
					headers: {
						'User-Agent': `ledger-self-hosted (${cfg.email ?? 'no contact configured'})`,
						Accept: 'application/json'
					},
					signal: AbortSignal.timeout(TIMEOUT_MS)
				});
				// 429 included: a rate-limited provider has no answer, and the caller's
				// fallback is the same as for "no such place".
				if (!res.ok) return [];

				const body: unknown = await res.json();
				if (!Array.isArray(body)) return [];

				return body
					.slice(0, limit)
					.map((row: NominatimRow) => {
						const lat = Number(row?.lat);
						const lng = Number(row?.lon);
						const label = (row?.display_name ?? row?.name ?? '').trim();
						if (!label) return null;
						const coords = { lat, lng };
						// The provider is not trusted to return a point on Earth.
						return isValidCoords(coords) ? { coords, label } : null;
					})
					.filter((r): r is GeocodeResult => r !== null);
			} catch {
				// Offline, timed out, DNS failure, malformed JSON — all the same
				// answer, which is no answer.
				return [];
			}
		}
	};
}
