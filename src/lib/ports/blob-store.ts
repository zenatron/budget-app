/**
 * Content-addressed blob storage. Ids are `<sha256hex>.<ext>` of the stored
 * bytes — identical content dedupes for free, and blobs are append-only
 * (safe to back up after the DB dump). Content-addressing is NOT authorization;
 * every serve goes through a workspace + seal check.
 */
export interface StoredBlob {
	id: string;
	byteSize: number;
}

export interface BlobStore {
	put(data: Uint8Array, ext: string): Promise<StoredBlob>;
	get(id: string): Promise<Uint8Array | null>;
	exists(id: string): Promise<boolean>;
	delete(id: string): Promise<void>;
}
