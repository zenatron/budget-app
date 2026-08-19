import { error, redirect } from '@sveltejs/kit';
import { listWorkspacesForUser } from '$lib/repo/workspaces';
import { createShare } from '$lib/repo/shares';
import type { RequestHandler } from './$types';

/**
 * The manifest `share_target`: "share a receipt photo to Ledger" from the OS
 * share sheet. A POST (multipart) lands here because a static manifest cannot
 * name a workspace slug; the member's active workspace is resolved the same
 * way `/` resolves it, the photo is staged in the content-addressed blob
 * store behind a one-hour `pending_share` row, and the browser is pointed at
 * the new-purchase form, which picks it up and offers the same "Read this
 * receipt" path an attached photo always gets.
 *
 * No same-origin check, unlike read-image: the POST comes from the browser's
 * own share sheet, not from app markup. SvelteKit's built-in CSRF check still
 * applies to cross-site form posts, and a staged row is only ever readable by
 * the member who shared it. A text-only share skips staging entirely and
 * prefills the form from the shared words.
 */

/** Matches the form's photo input and what processUpload accepts. */
const ALLOWED = new Set(['image/webp', 'image/jpeg', 'image/png']);

/** Same bound as read-image: refuse the absurd, allow any real photo. */
const MAX_BYTES = 10 * 1024 * 1024;

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) redirect(303, '/');

	const memberships = await listWorkspacesForUser(locals.db, locals.user.id);
	if (memberships.length === 0) redirect(303, '/welcome');

	const active = memberships.find((m) => m.workspace.id === locals.session?.activeWorkspaceId);
	const target = active ?? memberships[0];

	const form = await request.formData().catch(() => null);
	const text = [form?.get('title'), form?.get('text'), form?.get('url')]
		.filter((v): v is string => typeof v === 'string')
		.join('\n')
		.trim();
	const file = form?.get('photo');

	if (!(file instanceof File) || file.size === 0) {
		// Text-only share: nothing to stage, the form can carry it in the URL.
		const qs = text ? `?shareText=${encodeURIComponent(text.slice(0, 500))}` : '';
		redirect(303, `/w/${target.workspace.slug}/purchases/new${qs}`);
	}

	if (!ALLOWED.has(file.type)) error(415, 'That image type is not supported');
	if (file.size > MAX_BYTES) error(413, 'That image is too large');

	// Original bytes, not a derivative: the new-purchase form runs its own
	// processing pipeline on submit, exactly as if the file had been picked
	// there. The extension is the id's suffix, so it should be the truth.
	const ext = file.type === 'image/webp' ? 'webp' : file.type === 'image/png' ? 'png' : 'jpg';
	const stored = await locals.deps.blobs.put(new Uint8Array(await file.arrayBuffer()), ext);
	const id = await createShare(locals.db, locals.deps, {
		workspaceId: target.workspace.id,
		memberId: target.member.id,
		blobId: stored.id,
		filename: file.name || 'shared',
		contentType: file.type,
		byteSize: stored.byteSize
	});
	redirect(303, `/w/${target.workspace.slug}/purchases/new?share=${id}`);
};
