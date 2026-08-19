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

/**
 * Which static host this build is for. The two disagree about how to serve a
 * client-routed app, and the disagreement is not symmetric:
 *
 *   cloudflare  Falls back to index.html for unmatched paths *only when there
 *               is no top-level 404.html*. Shipping one silently turns SPA
 *               routing off and every deep link 404s. We write an explicit
 *               `_redirects` rewrite instead, which also answers 200 rather
 *               than 404.
 *   github      Has no rewrite rules at all and serves 404.html for anything
 *               it cannot find, so that file *is* the fallback.
 */
const HOST = (process.env.DEMO_HOST ?? 'cloudflare') as 'cloudflare' | 'github';

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

	if (HOST === 'github') {
		// The fallback *is* 404.html here — GitHub Pages has no rewrite rules.
		await copyFile(`${OUT}/index.html`, `${OUT}/404.html`);
		// Jekyll would skip SvelteKit's _app/ directory outright.
		await writeFile(`${OUT}/.nojekyll`, '');
	} else {
		// A rewrite, not a redirect: the URL is preserved and the status is 200,
		// so a deep link is not reported as missing. Deliberately no 404.html —
		// its presence is what disables Cloudflare's SPA fallback.
		await writeFile(`${OUT}/_redirects`, '/* /index.html 200\n');

		// The hashed bundles never change under their own name; the seed can, so
		// it is left on the default revalidating policy.
		await writeFile(
			`${OUT}/_headers`,
			['/_app/immutable/*', '  Cache-Control: public, max-age=31536000, immutable', ''].join('\n')
		);
	}

	// The manifest is static JSON, so it cannot use %sveltekit.assets%. Under a
	// project-site base its scope and icons would point at the domain root.
	const manifestPath = `${OUT}/manifest.webmanifest`;
	if (BASE && (await exists(manifestPath))) {
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		manifest.start_url = `${BASE}/`;
		manifest.scope = `${BASE}/`;
		const rebase = (src: string) => (src.startsWith('/') ? `${BASE}${src}` : src);
		if (Array.isArray(manifest.icons)) {
			manifest.icons = manifest.icons.map((icon: { src: string }) => ({
				...icon,
				src: rebase(icon.src)
			}));
		}
		if (Array.isArray(manifest.screenshots)) {
			manifest.screenshots = manifest.screenshots.map((shot: { src: string }) => ({
				...shot,
				src: rebase(shot.src)
			}));
		}
		if (Array.isArray(manifest.shortcuts)) {
			manifest.shortcuts = manifest.shortcuts.map(
				(sc: { url: string; icons?: { src: string }[] }) => ({
					...sc,
					url: sc.url.startsWith('/') ? `${BASE}${sc.url}` : sc.url,
					icons: Array.isArray(sc.icons)
						? sc.icons.map((icon) => ({ ...icon, src: rebase(icon.src) }))
						: sc.icons
				})
			);
		}
		await writeFile(manifestPath, JSON.stringify(manifest, null, '\t') + '\n');
	}

	// The share target needs the server route behind POST /share, which the
	// static demo does not ship. A share into the demo would be a 404 from the
	// OS sheet — so the affordance is removed rather than left broken.
	if (await exists(manifestPath)) {
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		if ('share_target' in manifest) {
			delete manifest.share_target;
			await writeFile(manifestPath, JSON.stringify(manifest, null, '\t') + '\n');
		}
	}

	console.log(`demo finalized in build-demo/ for ${HOST}${BASE ? ` (base ${BASE})` : ''}`);
}

main().catch((e) => {
	console.error('demo-finalize failed:', e?.message ?? e);
	process.exit(1);
});
