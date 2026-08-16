import type { Clock } from './clock';
import type { IdGenerator } from './id-generator';
import type { Notifier } from './notifier';
import type { BlobStore } from './blob-store';

/**
 * Every driven port a use case might need, in one bag.
 *
 * This is deliberately *wider* than what any individual use case asks for. The
 * use cases in `$lib/application` keep declaring their own narrow `Deps` — the
 * one that needs a clock and nothing else should say so, and stay callable from
 * a test that supplies only a clock. Structural typing means an `AppDeps`
 * satisfies all of them without any of them naming this type.
 *
 * So this is not the use cases' contract. It is the *composition root's*
 * contract: the thing an adapter builds once per request, so routes stop
 * assembling `{ clock: systemClock, ids: uuidv7 }` by hand.
 */
export interface AppDeps {
	clock: Clock;
	ids: IdGenerator;
	notifier: Notifier;
	blobs: BlobStore;
}
