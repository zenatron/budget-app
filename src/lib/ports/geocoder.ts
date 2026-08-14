import type { Coords } from '$lib/domain/location/coords';

/**
 * The port a typed address is resolved through.
 *
 * Optional in the same way the LLM assist is optional: the null adapter is the
 * default, and with it the whole places feature still works — the device's own
 * location and a pasted map link both resolve without ever reaching this port,
 * because a map URL already contains its answer and reading it is arithmetic.
 * A geocoder only adds "type an address and get a pin".
 *
 * **Nothing here ever throws.** Off, unreachable, rate-limited, timed out, or
 * returning nonsense all resolve to an empty result, and the caller falls back
 * to exactly what it would have done with no geocoder at all. This mirrors the
 * contract on `LlmAssist` and exists for the same reason: an optional
 * dependency that can fail loudly is not optional.
 *
 * It is also deliberately **server-side only**. Address text is a strong signal
 * about where somebody is going, so it leaves the deployment through the
 * server's own outbound connection or not at all — which is what keeps the
 * app's `connect-src` at 'self'.
 */

export interface GeocodeResult {
	/** Coordinates as the provider gave them; the caller still rounds to E3. */
	coords: Coords;
	/** A human-readable name for the place, for the picker and the pin's label. */
	label: string;
}

export interface GeocoderProvider {
	kind: 'off' | 'nominatim';
	endpoint: string | null;
}

export interface Geocoder {
	/** False when the layer is off or misconfigured — callers gate on this. */
	readonly available: boolean;

	/** For the settings screen: what this instance is pointed at. */
	describe(): GeocoderProvider;

	/**
	 * Resolve free text to at most `limit` candidate places, best first.
	 *
	 * Returns `[]` for anything it cannot answer, including every failure mode.
	 * Callers must treat an empty array as "no answer", never as "no such place".
	 */
	search(query: string, limit?: number): Promise<GeocodeResult[]>;
}

/**
 * The default. Answers nothing, fails at nothing, and reaches no network — a
 * deployment that never sets `GEOCODER_URL` runs entirely on this.
 */
export const nullGeocoder: Geocoder = {
	available: false,
	describe: () => ({ kind: 'off', endpoint: null }),
	search: async () => []
};
