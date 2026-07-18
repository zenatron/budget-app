/**
 * Minimal OIDC provider for LOCAL DEVELOPMENT AND E2E TESTS ONLY.
 * Implements just enough of the spec (discovery, authorize, token, JWKS,
 * PKCE S256, RS256 id_tokens) to exercise the app's real openid-client flow
 * without a Pocket ID instance. Auto-approves every authorization request.
 *
 *   bun scripts/dev-oidc.ts            # listens on :9443
 *   curl http://localhost:9443/_as/bob # switch the user it logs in as
 */

const PORT = 9443;
const ISSUER = `http://localhost:${PORT}`;

const USERS: Record<string, { sub: string; email: string; name: string }> = {
	alice: { sub: 'sub-alice-001', email: 'alice@example.com', name: 'Alice Test' },
	bob: { sub: 'sub-bob-002', email: 'bob@example.com', name: 'Bob Test' },
	carol: { sub: 'sub-carol-003', email: 'carol@example.com', name: 'Carol Test' }
};
let currentUser = 'alice';

const keyPair = (await crypto.subtle.generateKey(
	{
		name: 'RSASSA-PKCS1-v1_5',
		modulusLength: 2048,
		publicExponent: new Uint8Array([1, 0, 1]),
		hash: 'SHA-256'
	},
	true,
	['sign', 'verify']
)) as CryptoKeyPair;
const publicJwk = {
	...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)),
	kid: 'dev-1',
	use: 'sig',
	alg: 'RS256'
};

const codes = new Map<
	string,
	{ nonce: string; challenge: string; clientId: string; user: string }
>();

const b64url = (data: Uint8Array | string): string =>
	Buffer.from(typeof data === 'string' ? new TextEncoder().encode(data) : data).toString(
		'base64url'
	);

async function signJwt(payload: Record<string, unknown>): Promise<string> {
	const data = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'dev-1' }))}.${b64url(JSON.stringify(payload))}`;
	const sig = await crypto.subtle.sign(
		'RSASSA-PKCS1-v1_5',
		keyPair.privateKey,
		new TextEncoder().encode(data)
	);
	return `${data}.${b64url(new Uint8Array(sig))}`;
}

async function s256(verifier: string): Promise<string> {
	return b64url(
		new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
	);
}

Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);

		if (url.pathname === '/.well-known/openid-configuration') {
			return Response.json({
				issuer: ISSUER,
				authorization_endpoint: `${ISSUER}/authorize`,
				token_endpoint: `${ISSUER}/token`,
				jwks_uri: `${ISSUER}/jwks`,
				response_types_supported: ['code'],
				grant_types_supported: ['authorization_code'],
				subject_types_supported: ['public'],
				id_token_signing_alg_values_supported: ['RS256'],
				code_challenge_methods_supported: ['S256'],
				scopes_supported: ['openid', 'profile', 'email'],
				token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post']
			});
		}

		if (url.pathname === '/jwks') {
			return Response.json({ keys: [publicJwk] });
		}

		if (url.pathname.startsWith('/_as/')) {
			const who = url.pathname.slice(5);
			if (!USERS[who]) return new Response('unknown user', { status: 404 });
			currentUser = who;
			return new Response(`now logging in as ${who}\n`);
		}

		if (url.pathname === '/authorize') {
			const p = url.searchParams;
			const code = crypto.randomUUID();
			codes.set(code, {
				nonce: p.get('nonce') ?? '',
				challenge: p.get('code_challenge') ?? '',
				clientId: p.get('client_id') ?? '',
				user: p.get('as') ?? currentUser
			});
			const back = new URL(p.get('redirect_uri')!);
			back.searchParams.set('code', code);
			back.searchParams.set('state', p.get('state') ?? '');
			back.searchParams.set('iss', ISSUER);
			return Response.redirect(back.href, 302);
		}

		if (url.pathname === '/token' && req.method === 'POST') {
			const body = new URLSearchParams(await req.text());
			const grant = codes.get(body.get('code') ?? '');
			if (!grant) return Response.json({ error: 'invalid_grant' }, { status: 400 });
			codes.delete(body.get('code')!);
			const verifier = body.get('code_verifier') ?? '';
			if ((await s256(verifier)) !== grant.challenge) {
				return Response.json(
					{ error: 'invalid_grant', error_description: 'PKCE failed' },
					{ status: 400 }
				);
			}
			const u = USERS[grant.user];
			const now = Math.floor(Date.now() / 1000);
			const idToken = await signJwt({
				iss: ISSUER,
				sub: u.sub,
				aud: grant.clientId,
				exp: now + 300,
				iat: now,
				nonce: grant.nonce,
				email: u.email,
				name: u.name,
				preferred_username: grant.user
			});
			return Response.json({
				access_token: crypto.randomUUID(),
				token_type: 'Bearer',
				expires_in: 3600,
				id_token: idToken
			});
		}

		return new Response('not found', { status: 404 });
	}
});

console.log(`dev-oidc: issuing for '${currentUser}' at ${ISSUER}`);
