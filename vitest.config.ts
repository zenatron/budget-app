import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Domain and infra unit tests only — pure TS, no Svelte compilation needed.
// E2E flows are covered by Playwright separately.
//
// $lib is aliased because SvelteKit only resolves it during a Kit build, and a
// module under test that imports through it would otherwise be untestable —
// which is why money-format had no unit tests until now.
export default defineConfig({
	resolve: {
		alias: {
			$lib: fileURLToPath(new URL('./src/lib', import.meta.url))
		}
	},
	test: {
		include: ['src/lib/**/*.test.ts'],
		environment: 'node'
	}
});
