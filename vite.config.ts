import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			adapter: adapter(),

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
