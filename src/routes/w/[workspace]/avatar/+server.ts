import { error } from '@sveltejs/kit';
import { getBlobStore } from '$lib/server/blobs';
import type { RequestHandler } from './$types';

/**
 * Serve the logged-in user's avatar.  Not gated on workspace membership beyond
 * what the layout hook already enforces — avatar blobs carry no secrets.  The
 * client appends the blob id as ?v=, and blob ids are content-addressed, so the
 * response is immutable: a replaced photo is a different URL entirely.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const blobId = locals.user?.avatarBlobId;
	if (!blobId) error(404, 'No avatar set');

	const data = await getBlobStore().get(blobId);
	if (!data) error(404, 'Not found');
	return new Response(new Uint8Array(data), {
		headers: {
			'Content-Type': 'image/webp',
			'Cache-Control': 'private, max-age=31536000, immutable'
		}
	});
};
