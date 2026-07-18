import { defineConfig } from '@playwright/test';

/**
 * E2E for the two security-critical flows: approval and sealing.
 * Requires the local postgres from `docker compose up -d db`.
 */
export default defineConfig({
	testDir: 'e2e',
	timeout: 60_000,
	// The fake IdP's "current user" is global state — no parallel workers.
	workers: 1,
	use: { baseURL: 'http://localhost:5174' },
	webServer: [
		{
			command: 'bun scripts/dev-oidc.ts',
			port: 9443,
			reuseExistingServer: true
		},
		{
			command: 'bun run dev -- --port 5174 --strictPort',
			port: 5174,
			reuseExistingServer: false,
			env: {
				DATABASE_URL: 'postgres://root:mysecretpassword@localhost:5432/local',
				POCKET_ID_ISSUER: 'http://localhost:9443',
				POCKET_ID_CLIENT_ID: 'budget-e2e',
				POCKET_ID_CLIENT_SECRET: 'e2e-secret',
				OIDC_REDIRECT_URI: 'http://localhost:5174/auth/callback',
				PUBLIC_ORIGIN: 'http://localhost:5174'
			}
		}
	]
});
