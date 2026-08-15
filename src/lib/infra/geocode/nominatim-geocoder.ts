import { isValidCoords } from '$lib/domain/location/coords';
import type { Geocoder, GeocodeResult, GeocoderHealth } from '$lib/ports/geocoder';

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
/*
 * The health probe gets longer. A geocoder that takes four seconds to answer is
 * a broken search box but a *working* geocoder, and reporting it as unreachable
 * would send an operator hunting for a container that is running fine.
 */
const HEALTH_TIMEOUT_MS = 10_000;

interface NominatimRow {
	lat?: string;
	lon?: string;
	display_name?: string;
	name?: string;
}

/**
 * Join a path onto the configured endpoint, keeping any base path it carries.
 *
 * `new URL('/search', base)` throws that base path away, so an endpoint behind
 * a reverse proxy at `https://example.com/nominatim` had every request land on
 * `https://example.com/search` — a 404, which this adapter's contract turns
 * into an empty list, which the form shows as "nothing found". Exactly the kind
 * of silent misconfiguration the health probe exists to surface, so it would be
 * strange to leave the adapter causing one.
 */
function apiUrl(endpoint: string, path: string): URL {
	const base = endpoint.endsWith('/') ? endpoint : `${endpoint}/`;
	return new URL(path, base);
}

export function nominatimGeocoder(cfg: { endpoint: string; email?: string }): Geocoder {
	/*
	 * Per-instance, and `getGeocoder` memoizes the instance so there is exactly
	 * one per process — that memo is what makes this gate real. Building a fresh
	 * adapter per HTTP request gave every request its own allowance, which is
	 * indistinguishable from having no gate at all.
	 */
	let nextAllowedAt = 0;

	/*
	 * The wildcard in this Accept header is not padding — it is the whole point.
	 *
	 * The mediagis image serves Nominatim through Apache with MultiViews, which
	 * maps `/search` onto `search.php` by content negotiation. A bare
	 * `Accept: application/json` matches no variant of a PHP script, so Apache
	 * answers 406 "no acceptable variant" before Nominatim runs at all — and this
	 * adapter's contract turns every non-ok response into an empty list, which
	 * the form shows as "nothing found". A correctly imported country-sized
	 * extract failed every single search for that reason, and nothing in the app
	 * could say so.
	 *
	 * The format is already pinned by the `format` query parameter, so the header
	 * was never doing the work it looked like it was doing. It stays, weighted,
	 * for endpoints that do negotiate properly.
	 */
	const headers = {
		'User-Agent': `ledger-self-hosted (${cfg.email ?? 'no contact configured'})`,
		Accept: 'application/json, */*;q=0.8'
	};

	/** The request itself, with no rate gate. Every caller here owns its own gating. */
	async function fetchSearch(q: string, limit: number, timeoutMs: number) {
		const url = apiUrl(cfg.endpoint, 'search');
		url.searchParams.set('q', q);
		url.searchParams.set('format', 'jsonv2');
		url.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 10)));
		url.searchParams.set('addressdetails', '0');
		if (cfg.email) url.searchParams.set('email', cfg.email);

		const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
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
	}

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
				return await fetchSearch(q, limit, TIMEOUT_MS);
			} catch {
				// Offline, timed out, DNS failure, malformed JSON — all the same
				// answer, which is no answer.
				return [];
			}
		},

		/*
		 * Deliberately outside the one-per-second gate.
		 *
		 * The gate protects a provider from a typing user. This runs on an owner
		 * clicking a button on a settings page, at most a couple of requests, and
		 * a diagnostic that reports "unreachable" because it was rate-limited by
		 * its own app would be worse than useless — it is the exact confusion the
		 * probe exists to end.
		 */
		async checkHealth(probeQuery?: string): Promise<GeocoderHealth> {
			const base: GeocoderHealth = {
				state: 'unreachable',
				detail: '',
				dataUpdated: null,
				probe: null
			};

			// Only the one field survives the block; scoping the parsed status inside
			// the `try` keeps its shape from leaking past the point it is understood.
			let dataUpdated: string | null;
			try {
				const url = apiUrl(cfg.endpoint, 'status');
				url.searchParams.set('format', 'json');
				const res = await fetch(url, {
					headers,
					signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
				});
				const body: unknown = await res.json().catch(() => null);
				const status: { status?: number; message?: string; data_updated?: string } | null =
					body && typeof body === 'object' ? body : null;

				/*
				 * A 4xx is the web server rejecting the request, not Nominatim
				 * answering it — a wrong path, or Apache's content negotiation
				 * refusing the request shape (406). Reporting that as "the database
				 * isn't ready" sent an operator to watch an import that had already
				 * finished hours earlier, which is the opposite of this panel's job.
				 * Only the server can distinguish these, so its own code is quoted.
				 */
				if (res.status >= 400 && res.status < 500) {
					return {
						...base,
						state: 'starting',
						detail: `${cfg.endpoint} is running, but rejected the request with HTTP ${res.status} before Nominatim saw it. That is the web server in front of it, not the data. Check that the URL points at the API root.`
					};
				}

				if (status?.status !== 0) {
					/*
					 * Something is listening but its database isn't serving. For a
					 * mediagis container this is the window after Apache comes up and
					 * before the import finishes, and Nominatim's own message (700
					 * "Database connection failed", 702 "Query failed") says more than
					 * anything we could invent.
					 */
					return {
						...base,
						state: 'starting',
						detail: `${cfg.endpoint} answered, but its database isn't ready: ${
							status?.message ?? `HTTP ${res.status}`
						}. An import in progress looks exactly like this — watch the container's logs.`
					};
				}
				dataUpdated = typeof status.data_updated === 'string' ? status.data_updated : null;
			} catch {
				/*
				 * Refused, DNS failure, or timed out. Worth being explicit that this
				 * is *also* what a running import looks like: mediagis/nominatim does
				 * not start its web server until the import finishes, so hours of
				 * healthy work are indistinguishable from a container that never came
				 * up. Naming that is the whole point.
				 */
				return {
					...base,
					detail: `Nothing answered at ${cfg.endpoint}. Either it isn't running, the address is wrong, or an import is still in progress: the web server doesn't start until an import finishes, which can take hours.`
				};
			}

			const ready: GeocoderHealth = {
				...base,
				state: 'ready',
				detail: `${cfg.endpoint} is up and serving.`,
				dataUpdated
			};

			const q = probeQuery?.trim() ?? '';
			if (q.length < 3) return ready;

			try {
				const rows = await fetchSearch(q, 3, HEALTH_TIMEOUT_MS);
				return {
					...ready,
					probe: { query: q, found: rows.length, first: rows[0]?.label ?? null },
					detail:
						rows.length > 0
							? `${cfg.endpoint} is up, and this place is in its data.`
							: `${cfg.endpoint} is up and serving, but it has nothing for that. The extract it imported probably doesn't cover there, or the text isn't an address it can parse.`
				};
			} catch {
				return {
					...ready,
					detail: `${cfg.endpoint} reports itself healthy, but the test search failed to complete.`
				};
			}
		}
	};
}
