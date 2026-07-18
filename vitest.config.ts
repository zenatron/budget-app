import { defineConfig } from 'vitest/config';

// Domain and infra unit tests only — pure TS, no Svelte compilation needed.
// E2E flows are covered by Playwright separately.
export default defineConfig({
	test: {
		include: ['src/lib/**/*.test.ts'],
		environment: 'node'
	}
});
