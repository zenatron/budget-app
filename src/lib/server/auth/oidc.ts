import * as oidc from 'openid-client';
import { getEnv } from '$lib/server/env';

/**
 * Pocket ID OIDC client. Authorization-code flow with PKCE, state, and nonce.
 * Discovery document and JWKS are fetched once and cached for the process
 * lifetime; openid-client refreshes JWKS itself on unknown `kid`.
 */

let cached: oidc.Configuration | undefined;

export class OidcNotConfiguredError extends Error {
	constructor() {
		super(
			'OIDC is not configured: set POCKET_ID_ISSUER, POCKET_ID_CLIENT_ID, POCKET_ID_CLIENT_SECRET, OIDC_REDIRECT_URI'
		);
		this.name = 'OidcNotConfiguredError';
	}
}

export async function getOidcConfig(): Promise<oidc.Configuration> {
	if (cached) return cached;
	const env = getEnv();
	if (
		!env.POCKET_ID_ISSUER ||
		!env.POCKET_ID_CLIENT_ID ||
		!env.POCKET_ID_CLIENT_SECRET ||
		!env.OIDC_REDIRECT_URI
	) {
		throw new OidcNotConfiguredError();
	}
	const issuer = new URL(env.POCKET_ID_ISSUER);
	// http is only ever legitimate for a localhost issuer (dev fixture).
	const options =
		issuer.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(issuer.hostname)
			? { execute: [oidc.allowInsecureRequests] }
			: undefined;
	cached = await oidc.discovery(
		issuer,
		env.POCKET_ID_CLIENT_ID,
		env.POCKET_ID_CLIENT_SECRET,
		undefined,
		options
	);
	return cached;
}

export interface LoginStart {
	url: URL;
	state: string;
	nonce: string;
	codeVerifier: string;
}

export async function startLogin(): Promise<LoginStart> {
	const env = getEnv();
	const config = await getOidcConfig();
	const codeVerifier = oidc.randomPKCECodeVerifier();
	const state = oidc.randomState();
	const nonce = oidc.randomNonce();
	const url = oidc.buildAuthorizationUrl(config, {
		redirect_uri: env.OIDC_REDIRECT_URI!,
		scope: env.OIDC_SCOPES,
		code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
		code_challenge_method: 'S256',
		state,
		nonce
	});
	return { url, state, nonce, codeVerifier };
}

export interface OidcIdentity {
	subject: string;
	email: string;
	displayName: string;
}

export async function finishLogin(
	callbackUrl: URL,
	checks: { state: string; nonce: string; codeVerifier: string }
): Promise<OidcIdentity> {
	const config = await getOidcConfig();
	const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
		pkceCodeVerifier: checks.codeVerifier,
		expectedState: checks.state,
		expectedNonce: checks.nonce,
		idTokenExpected: true
	});
	const claims = tokens.claims();
	if (!claims?.sub) throw new Error('OIDC: id_token missing sub');
	const email = typeof claims.email === 'string' ? claims.email : '';
	const displayName =
		(typeof claims.name === 'string' && claims.name) ||
		(typeof claims.preferred_username === 'string' && claims.preferred_username) ||
		email ||
		claims.sub;
	return { subject: claims.sub, email, displayName };
}
