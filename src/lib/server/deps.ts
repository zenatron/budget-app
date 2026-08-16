import type { AppDeps } from '$lib/ports/deps';
import { systemClock } from '$lib/infra/time/system-clock';
import { uuidv7 } from '$lib/infra/id/uuidv7';
import { getNotifier } from '$lib/server/notify';
import { getBlobStore } from '$lib/server/blobs';
import { processAvatar, processUpload } from '$lib/infra/images/process';
import { getEnv } from '$lib/server/env';
import { visionGate } from '$lib/server/vision-gate';

let instance: AppDeps | undefined;

/**
 * The server's driven ports, bound to their real adapters.
 *
 * This is the server half of the composition root — the one place that decides
 * "clock means the system clock, ids mean uuidv7". Ten route modules used to
 * each assemble their own `{ clock: systemClock, ids: uuidv7 }`; they take this
 * instead, via `locals.deps`.
 *
 * Memoized because `getNotifier()` and `getBlobStore()` already are, and a
 * fresh wrapper per request would just be garbage.
 */
export function serverDeps(): AppDeps {
	if (!instance) {
		instance = {
			clock: systemClock,
			ids: uuidv7,
			notifier: getNotifier(),
			blobs: getBlobStore(),
			images: { processUpload, processAvatar },
			capabilities: {
				vision: visionGate,
				geocoder: !!getEnv().GEOCODER_URL,
				barcode: !!getEnv().BARCODE_LOOKUP_URL
			}
		};
	}
	return instance;
}
