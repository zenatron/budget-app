/**
 * Post-build fixes for the static demo.
 *
 * Everything here has to happen after `vite build`, and all of it is about the
 * two ways a static host differs from the app's own server: it serves whatever
 * files exist at whatever prefix, and it has no router.
 *
 *   bun scripts/demo-finalize.ts
 */
import { copyFile, readFile, writeFile, access } from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const OUT = `${ROOT}/build-demo`;
const SEED = `${ROOT}/demo-assets/demo-seed.tar.gz`;

/** Matches vite.config.ts — a project site is served from /<repo>. */
const BASE = process.env.DEMO_BASE ?? '';

async function exists(p: string): Promise<boolean> {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
}

async function main() {
	if (!(await exists(`${OUT}/index.html`))) {
		throw new Error('build-demo/index.html missing — run the demo build first');
	}

	// The seed lives outside static/ on purpose: everything in static/ is copied
	// into *every* build, and production has no use for 5 MB of demo data.
	if (!(await exists(SEED))) {
		throw new Error('demo-assets/demo-seed.tar.gz missing — run `bun run demo:seed` first');
	}
	await copyFile(SEED, `${OUT}/demo-seed.tar.gz`);

	// GitHub Pages serves 404.html for any path it has no file for. Making it the
	// SPA fallback is what lets a deep link like /w/demo/buckets resolve.
	await copyFile(`${OUT}/index.html`, `${OUT}/404.html`);

	// Pages' Actions deployment serves the artifact as-is rather than running
	// Jekyll, but Jekyll would skip SvelteKit's _app/ directory outright, so this
	// removes any doubt for other static hosts too.
	await writeFile(`${OUT}/.nojekyll`, '');

	// The manifest is static JSON, so it cannot use %sveltekit.assets%. Under a
	// project-site base its scope and icons would point at the domain root.
	const manifestPath = `${OUT}/manifest.webmanifest`;
	if (BASE && (await exists(manifestPath))) {
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		manifest.start_url = `${BASE}/`;
		manifest.scope = `${BASE}/`;
		if (Array.isArray(manifest.icons)) {
			manifest.icons = manifest.icons.map((icon: { src: string }) => ({
				...icon,
				src: icon.src.startsWith('/') ? `${BASE}${icon.src}` : icon.src
			}));
		}
		await writeFile(manifestPath, JSON.stringify(manifest, null, '\t') + '\n');
	}

	console.log(`demo finalized in build-demo/${BASE ? ` (base ${BASE})` : ''}`);
}

main().catch((e) => {
	console.error('demo-finalize failed:', e?.message ?? e);
	process.exit(1);
});
