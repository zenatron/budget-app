import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { locatedSpending } from '$lib/repo/analytics';
import { addDays } from '$lib/domain/recurrence/rrule';
import { systemClock } from '$lib/infra/time/system-clock';
import { pad, periodFromUrl } from '$lib/server/analytics-period';
import { getEnv } from '$lib/server/env';
import type { PageServerLoad } from './$types';

/**
 * The spending map's data.
 *
 * Every point comes back at once, for the period, and the clustering happens in
 * the browser. That is a deliberate choice for this app rather than a shortcut:
 * a household is 2–10 people, so the located subset of one period is on the
 * order of a hundred rows — around 20 KB of JSON — and having it all client-side
 * is what lets a pinch re-cluster at 60fps instead of waiting on a round trip
 * per zoom level. `MAP_POINT_CAP` bounds the pathological case, and the load
 * reports when it bites rather than quietly showing a subset.
 *
 * The seal filter is not applied here; it is applied inside `locatedSpending`,
 * through the same `spentInPeriod` predicate every other figure on Activity
 * uses. A purchase this viewer cannot see contributes no bubble they can see.
 */
export const load: PageServerLoad = async ({ locals, url, params }) => {
	void params.workspace;
	const ws = locals.workspace!;
	if (!ws.locationEnabled) {
		// Not a 404: the workspace exists and so does the screen — it is turned
		// off, and saying so is more useful than pretending the URL is wrong.
		error(403, 'Places are turned off for this workspace');
	}

	const db = getDb();
	const now = systemClock.now();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const weekStartDay = (ws as any).weekStartDay ?? 1;
	// The same resolution the Activity page uses, so stepping the period here and
	// stepping it there land on identical windows.
	const { period, cfg } = periodFromUrl(url, { timezone: ws.timezone, weekStartDay }, now);

	const scope = { workspaceId: ws.id, viewerId: locals.member!.id, timezone: ws.timezone };
	const { points, truncated } = await locatedSpending(db, scope, cfg.queryPeriod, now);

	// Inclusive calendar dates, matching how the Activity page builds its ledger
	// links — "Jul 1 – Jul 31", not "Jul 1 – Aug 1".
	const lastDay = addDays(cfg.queryPeriod.toExclusive, -1);
	const env = getEnv();

	return {
		period,
		label: cfg.label,
		hasPrev: cfg.hasPrev,
		hasNext: cfg.hasNext,
		nav: cfg.nav,
		rangeFrom: `${cfg.queryPeriod.from.y}-${pad(cfg.queryPeriod.from.m)}-${pad(cfg.queryPeriod.from.d)}`,
		rangeTo: `${lastDay.y}-${pad(lastDay.m)}-${pad(lastDay.d)}`,
		currency: ws.currency,
		truncated,
		/*
		 * Null when no basemap is configured, and that is the default rather than
		 * a degraded state: the map draws a plotted graticule instead of streets,
		 * which needs no third party and is the more honest reading of this app's
		 * "printed statement" direction anyway. Tiles are the concession.
		 */
		tileUrl: env.MAP_TILE_URL ? `/w/${ws.slug}/tiles` : null,
		tileAttribution: env.MAP_TILE_ATTRIBUTION,
		points: points.map((p) => ({
			id: p.purchaseId,
			itemName: p.itemName,
			latE3: p.latE3,
			lngE3: p.lngE3,
			// Serialized as a string: bigint doesn't survive devalue, and a Number
			// would silently lose cents on a big enough total.
			amountMinor: p.totalMinor.toString(),
			label: p.label,
			color: p.color,
			inherited: p.inherited
		}))
	};
};
