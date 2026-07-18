import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BlobStore } from '$lib/ports/blob-store';

const BLOB_ID_RE = /^[a-f0-9]{64}\.[a-z0-9]{1,8}$/;

/** `blobs/ab/cd/abcdef….webp` under the configured root. */
export function createFsBlobStore(rootDir: string): BlobStore {
	function pathFor(id: string): string {
		if (!BLOB_ID_RE.test(id)) throw new Error(`Invalid blob id: ${JSON.stringify(id)}`);
		return join(rootDir, id.slice(0, 2), id.slice(2, 4), id);
	}

	return {
		async put(data, ext) {
			const hash = createHash('sha256').update(data).digest('hex');
			const id = `${hash}.${ext}`;
			const path = pathFor(id);
			try {
				await stat(path); // already stored — content-addressed dedupe
				return { id, byteSize: data.byteLength };
			} catch {
				// fall through to write
			}
			await mkdir(dirname(path), { recursive: true });
			// Write via temp file + rename so a crash never leaves a torn blob.
			const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
			await writeFile(tmp, data);
			await rename(tmp, path);
			return { id, byteSize: data.byteLength };
		},

		async get(id) {
			try {
				return await readFile(pathFor(id));
			} catch {
				return null;
			}
		},

		async exists(id) {
			try {
				await stat(pathFor(id));
				return true;
			} catch {
				return false;
			}
		},

		async delete(id) {
			await rm(pathFor(id), { force: true });
		}
	};
}
