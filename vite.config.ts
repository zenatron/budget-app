import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import adapterStatic from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * The demo build: the same app with a different driving adapter — no server,
 * no database, Postgres compiled to WASM in the tab. It builds from the
 * generated route tree at `.demo/routes` (see scripts/demo-build.ts), which
 * holds only the demo's routes with their `+page.server.ts` replaced by a
 * `+page.ts` binding the same handlers to a browser context.
 */
const DEMO = !!process.env.DEMO;
/** GitHub Pages serves a project site from a subpath. */
const DEMO_BASE = (process.env.DEMO_BASE ?? '') as '' | `/${string}`;

/**
 * A short fingerprint of the seed snapshot, used to name the demo's IndexedDB
 * database.
 *
 * The seed is only downloaded when no local database exists, so without this a
 * returning visitor would keep the data from whenever they first arrived — a
 * redeploy with a changed schema would leave them on a database the new code
 * cannot read. Keying the name to the seed's contents means a new seed starts
 * fresh, while a redeploy that does not touch the seed leaves their edits alone.
 */
function seedId(): string {
	if (!DEMO) return 'dev';
	try {
		return createHash('sha256')
			.update(readFileSync('demo-assets/demo-seed.tar.gz'))
			.digest('hex')
			.slice(0, 12);
	} catch {
		// No snapshot yet — `demo:build` run before `demo:seed`. The build still
		// works; it just cannot claim a stable identity for the data.
		return 'unseeded';
	}
}

export default defineConfig({
	// A build-time constant, not an env lookup: it lets rolldown delete the demo
	// branch in `$lib/actions/submit.ts` outright, so the production bundle never
	// carries PGlite.
	define: { __DEMO__: JSON.stringify(DEMO), __DEMO_SEED_ID__: JSON.stringify(seedId()) },
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			adapter: DEMO
				? adapterStatic({ pages: 'build-demo', assets: 'build-demo', fallback: 'index.html' })
				: adapter(),

			...(DEMO
				? {
						files: { routes: '.demo/routes', hooks: { server: 'src/demo-hooks.server' } },
						paths: { base: DEMO_BASE, relative: false },
						// Nothing to prerender against: every load opens the in-tab
						// database, which only exists once the page is running.
						prerender: { entries: [] }
					}
				: {}),

			csp: {
				directives: {
					'default-src': ['self'],
					// Kit nonces its own inline scripts when script-src is set.
					//
					// wasm-unsafe-eval is what lets WebAssembly compile at all — the
					// barcode decoder falls back to a WASM build on Safari, which has
					// no BarcodeDetector. Despite the name it does *not* permit eval()
					// of JavaScript strings; it is the narrow directive that exists
					// precisely so allowing WASM doesn't mean allowing unsafe-eval.
					'script-src': ['self', 'wasm-unsafe-eval'],
					// Split so unsafe-inline covers only `style=` attributes (category
					// colors, bar widths) — an injected <style> element stays blocked.
					// Vite serves HMR styles as inline <style> elements, so dev keeps
					// the loose form.
					'style-src-elem':
						process.env.NODE_ENV === 'production' ? ['self'] : ['self', 'unsafe-inline'],
					'style-src-attr': ['unsafe-inline'],
					'img-src': ['self', 'data:', 'blob:'],
					'connect-src': ['self'],
					'worker-src': ['self'],
					'manifest-src': ['self'],
					'object-src': ['none'],
					'base-uri': ['self'],
					'form-action': ['self'],
					'frame-ancestors': ['none']
				}
			},

			typescript: {
				config: (config) => {
					config.include.push('../drizzle.config.ts');
				}
			}
		})
	],
	server: {
		allowedHosts: ['cachyos', 'localhost', '10.0.0.135', '.local']
	}
});
