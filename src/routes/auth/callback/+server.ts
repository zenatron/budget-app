import { error, redirect } from '@sveltejs/kit';
import { finishLogin } from '$lib/server/auth/oidc';
import { createSession, setSessionCookie } from '$lib/server/auth/session';
import { getDb } from '$lib/server/db';
import { upsertUserFromOidc } from '$lib/server/repo/users';
import { processAvatar } from '$lib/infra/images/process';
import { getBlobStore } from '$lib/server/blobs';
import { uuidv7 } from '$lib/infra/id/uuidv7';
import { systemClock } from '$lib/infra/time/system-clock';
import { user } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies, request, getClientAddress }) => {
	const state = cookies.get('oidc_state');
	const nonce = cookies.get('oidc_nonce');
	const codeVerifier = cookies.get('oidc_verifier');
	for (const name of ['oidc_state', 'oidc_nonce', 'oidc_verifier']) {
		cookies.delete(name, { path: '/' });
	}
	if (!state || !nonce || !codeVerifier) {
		error(400, 'Login flow expired — please try again');
	}

	let identity;
	try {
		identity = await finishLogin(url, { state, nonce, codeVerifier });
	} catch (e) {
		console.log(
			JSON.stringify({ level: 'warn', msg: 'oidc: callback rejected', err: (e as Error).message })
		);
		error(400, 'Login failed — please try again');
	}

	const db = getDb();
	const stored = await upsertUserFromOidc(db, { clock: systemClock, ids: uuidv7 }, identity);

	// On first login (no avatar set yet), pull the profile picture from the IdP.
	if (identity.picture && !stored.avatarBlobId) {
		try {
			const res = await fetch(identity.picture);
			if (res.ok) {
				const buf = new Uint8Array(await res.arrayBuffer());
				const derivative = await processAvatar(buf);
				const blob = await getBlobStore().put(derivative.data, '.webp');
				await db.update(user).set({ avatarBlobId: blob.id }).where(eq(user.id, stored.id));
			}
		} catch {
			// Picture couldn't be fetched — the user can upload one later.
		}
	}

	const session = await createSession(db, stored.id, {
		userAgent: request.headers.get('user-agent'),
		ip: getClientAddress()
	});
	setSessionCookie(cookies, session.id, session.expiresAt);
	redirect(303, '/');
};
