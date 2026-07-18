import { createFsBlobStore } from '$lib/infra/blob/fs-blob-store';
import type { BlobStore } from '$lib/ports/blob-store';
import { getEnv } from '$lib/server/env';

let instance: BlobStore | undefined;

export function getBlobStore(): BlobStore {
	if (!instance) instance = createFsBlobStore(getEnv().BLOB_DIR);
	return instance;
}
