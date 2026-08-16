import type { AppDeps } from '$lib/ports/deps';
import { systemClock } from '$lib/infra/time/system-clock';
import { uuidv7 } from '$lib/infra/id/uuidv7';
import { nullNotifier } from '$lib/ports/notifier';
import { createMemoryBlobStore } from './blob-store';

let instance: AppDeps | undefined;

/**
 * The demo's driven ports — the browser half of the composition root.
 *
 * Two of the four adapters are the production ones unchanged: the clock is
 * `new Date()` and uuidv7 uses `crypto.getRandomValues`, both Web APIs. Only
 * the two with real side effects are swapped — there is nobody to notify and
 * no filesystem to write to.
 */
export function demoDeps(): AppDeps {
	if (!instance) {
		instance = {
			clock: systemClock,
			ids: uuidv7,
			notifier: nullNotifier,
			blobs: createMemoryBlobStore()
		};
	}
	return instance;
}
