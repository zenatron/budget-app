import { redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { startLogin } from '$lib/server/auth/oidc';
import type { RequestHandler } from './$types';

const TEMP_COOKIE = {
	path: '/',
	httpOnly: true,
	secure: !dev,
	sameSite: 'lax',
	maxAge: 600
} as const;

export const GET: RequestHandler = async ({ cookies, locals }) => {
	if (locals.user) redirect(303, '/');
	const { url, state, nonce, codeVerifier } = await startLogin();
	cookies.set('oidc_state', state, TEMP_COOKIE);
	cookies.set('oidc_nonce', nonce, TEMP_COOKIE);
	cookies.set('oidc_verifier', codeVerifier, TEMP_COOKIE);
	redirect(303, url.href);
};
