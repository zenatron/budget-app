import { error, redirect } from '@sveltejs/kit';
import { clearSessionCookie, destroySession } from '$lib/server/auth/session';
import { getDb } from '$lib/server/db';
import { getEnv } from '$lib/server/env';
import type { RequestHandler } from './$types';

// Standalone endpoints skip SvelteKit's form-action CSRF check, so verify
// the Origin header ourselves.
export const POST: RequestHandler = async ({ request, cookies, locals }) => {
	const origin = request.headers.get('origin');
	const allowed = new URL(getEnv().PUBLIC_ORIGIN).origin;
	if (origin !== allowed && origin !== new URL(request.url).origin) {
		error(403, 'Cross-origin logout rejected');
	}
	if (locals.session) {
		await destroySession(getDb(), locals.session.id);
	}
	clearSessionCookie(cookies);
	redirect(303, '/');
};
