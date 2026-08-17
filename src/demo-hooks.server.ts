/**
 * The demo build's server hooks: deliberately none.
 *
 * `src/hooks.server.ts` is the app's authorization layer and background sweep —
 * sessions, membership checks, rate limiting, migrations. The demo has no
 * server, no session and nothing to authorize, and everything the real hook
 * puts on `locals` is instead assembled in the browser by
 * `$lib/demo/context.ts`.
 *
 * It still needs to exist as a module, because a static build runs the hooks
 * once while generating the SPA fallback page — and the real one reaches for
 * `getClientAddress()`, which does not exist during prerendering.
 */
export {};
