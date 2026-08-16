import type { Clock } from './clock';
import type { IdGenerator } from './id-generator';
import type { Notifier } from './notifier';
import type { BlobStore } from './blob-store';
import type { ImageProcessor } from './image-processor';
import type { Gate } from '$lib/domain/intelligence/capability-gate';
import type { WorkspaceRow } from '$lib/repo/workspaces';

/**
 * What this deployment can do, as opposed to what the workspace has enabled.
 *
 * Both of these were read straight from env inside route loads, which is the
 * one thing a handler cannot do and stay portable. They are environment facts,
 * so they belong to the composition root: the server resolves them from its
 * config and model catalog, and the demo — which ships neither a model nor a
 * geocoder — answers no.
 */
export interface AppCapabilities {
	/** Can a scanned, text-layer-free bill be read? Carries its own refusal
	 *  wording so the UI never has to invent one. */
	vision(workspace: WorkspaceRow): Promise<Gate>;
	/** Is place search wired up? */
	geocoder: boolean;
	/** Is barcode lookup wired up? */
	barcode: boolean;
}

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
	images: ImageProcessor;
	capabilities: AppCapabilities;
}
