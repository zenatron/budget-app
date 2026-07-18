import { env as rawEnv } from '$env/dynamic/private';
import * as v from 'valibot';

/**
 * Boot-time env validation. Parse, don't validate: everything downstream
 * imports the parsed object, never process.env. Fails loudly with every
 * problem listed, not just the first.
 *
 * Vars for later phases (OIDC, VAPID, ntfy) are optional here and become
 * required in the phase that ships the feature.
 */
const EnvSchema = v.object({
	DATABASE_URL: v.pipe(v.string(), v.regex(/^postgres(ql)?:\/\//, 'must be a postgres:// URL')),
	BLOB_DIR: v.optional(v.pipe(v.string(), v.nonEmpty()), './data/blobs'),
	PUBLIC_ORIGIN: v.optional(v.pipe(v.string(), v.url()), 'http://localhost:5173'),
	MIGRATIONS_DIR: v.optional(v.pipe(v.string(), v.nonEmpty()), './drizzle'),

	// Phase 1 — Pocket ID OIDC
	POCKET_ID_ISSUER: v.optional(v.pipe(v.string(), v.url())),
	POCKET_ID_CLIENT_ID: v.optional(v.string()),
	POCKET_ID_CLIENT_SECRET: v.optional(v.string()),
	OIDC_REDIRECT_URI: v.optional(v.pipe(v.string(), v.url())),
	OIDC_SCOPES: v.optional(v.string(), 'openid profile email'),

	// Phase 5 — push
	VAPID_PUBLIC_KEY: v.optional(v.string()),
	VAPID_PRIVATE_KEY: v.optional(v.string()),
	VAPID_SUBJECT: v.optional(v.string()),
	NTFY_SERVER_URL: v.optional(v.pipe(v.string(), v.url())),
	NTFY_DEFAULT_TOKEN: v.optional(v.string())
});

export type Env = v.InferOutput<typeof EnvSchema>;

let cached: Env | undefined;

/** Lazy so importing this module during `vite build` doesn't require a full env. */
export function getEnv(): Env {
	if (cached) return cached;
	// Empty string means unset (compose interpolation defaults produce "").
	const present = Object.fromEntries(Object.entries(rawEnv).filter(([, val]) => val !== ''));
	const result = v.safeParse(EnvSchema, present);
	if (!result.success) {
		const problems = result.issues
			.map((issue) => `  ${issue.path?.map((p) => p.key).join('.') ?? '(root)'}: ${issue.message}`)
			.join('\n');
		throw new Error(`Invalid environment:\n${problems}`);
	}
	cached = result.output;
	return cached;
}
