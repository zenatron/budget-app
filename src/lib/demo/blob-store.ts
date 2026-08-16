import type { BlobStore, StoredBlob } from '$lib/ports/blob-store';

/**
 * Content-addressed blobs in memory, for the demo build.
 *
 * Same contract as the filesystem store: the id is `<sha256hex>.<ext>` of the
 * bytes, so identical content dedupes and nothing is ever mutated in place.
 * SubtleCrypto gives us the same digest the server computes, so an id minted
 * here would be valid there.
 */
export function createMemoryBlobStore(): BlobStore {
	const blobs = new Map<string, Uint8Array>();

	return {
		async put(data: Uint8Array, ext: string): Promise<StoredBlob> {
			const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
			const hex = Array.from(new Uint8Array(digest))
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('');
			const id = `${hex}.${ext}`;
			if (!blobs.has(id)) blobs.set(id, data);
			return { id, byteSize: data.byteLength };
		},
		async get(id: string): Promise<Uint8Array | null> {
			return blobs.get(id) ?? null;
		},
		async exists(id: string): Promise<boolean> {
			return blobs.has(id);
		},
		async delete(id: string): Promise<void> {
			blobs.delete(id);
		}
	};
}
