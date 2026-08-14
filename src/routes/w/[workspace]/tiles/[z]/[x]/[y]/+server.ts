import { error } from '@sveltejs/kit';
import { getEnv } from '$lib/server/env';
import { rateLimitOk } from '$lib/server/rate-limit';
import { getTile, isValidTile } from '$lib/server/tiles';
import type { RequestHandler } from './$types';

/**
 * Basemap tiles, fetched by the server and re-served from our own origin.
 *
 * This route is the entire reason the Content-Security-Policy in vite.config
 * stays at `'self'` for both `img-src` and `connect-src`. The browser never
 * talks to the tile provider, so the provider never learns which household is
 * looking at which streets, and no CSP directive has to be widened to add a
 * basemap.
 *
 * It lives under the workspace layout so `locals.member` is already resolved.
 * Tiles carry no workspace data and have no seal implications — membership is
 * the whole check, and its job is to stop this being an open proxy that anyone
 * on the internet can point at somebody else's tile server.
 */
export const GET: RequestHandler = async ({ locals, params, setHeaders }) => {
	const env = getEnv();
	/*
	 * Unconfigured is not an error. The map is designed to work without a
	 * basemap, and 204 keeps the client's `<img> onerror` path meaning "a real
	 * failure" rather than firing on every tile of a deployment that simply
	 * never set MAP_TILE_URL.
	 */
	if (!env.MAP_TILE_URL) return new Response(null, { status: 204 });

	const z = Number(params.z);
	const x = Number(params.x);
	const y = Number(params.y);
	// Validated as integers in range before anything is interpolated into the
	// upstream URL. See the note in server/tiles.
	if (!isValidTile(z, x, y)) error(400, 'Not a tile');

	// A screenful is ~30 tiles and a hard pan session a few hundred, so this is
	// generous for a person and still stops a stuck client becoming a scraper
	// against a tile server we do not own.
	if (!rateLimitOk(`tiles:${locals.member!.id}`, 400, 60_000)) {
		error(429, 'Too many tiles');
	}

	const png = await getTile(env, z, x, y);
	if (!png) return new Response(null, { status: 204 });

	setHeaders({
		'Content-Type': 'image/png',
		// Private: these are re-served through an authenticated route, so no shared
		// cache should hold them. A week is well inside the on-disk TTL.
		'Cache-Control': 'private, max-age=604800'
	});
	return new Response(png);
};
