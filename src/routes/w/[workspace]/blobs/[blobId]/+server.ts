import { error } from '@sveltejs/kit';
import { isBlobVisible } from '$lib/application/images';
import { getBlobStore } from '$lib/server/blobs';
import { getDb } from '$lib/server/db';
import { systemClock } from '$lib/infra/time/system-clock';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
	const visible = await isBlobVisible(
		getDb(),
		{ workspaceId: locals.workspace!.id, viewerId: locals.member!.id },
		params.blobId,
		systemClock.now()
	);
	if (!visible) error(404, 'Not found');

	const data = await getBlobStore().get(params.blobId);
	if (!data) error(404, 'Not found');
	return new Response(new Uint8Array(data), {
		headers: {
			'Content-Type': 'image/webp',
			// Content-addressed: the bytes behind an id never change.
			'Cache-Control': 'private, max-age=31536000, immutable'
		}
	});
};
