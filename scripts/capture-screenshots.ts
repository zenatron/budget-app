/**
 * Captures the app screenshots — for the manifest's richer install UI and, as
 * the same bytes, the README's table. Run `bun run demo:build` first: the
 * script shoots the demo build against a throwaway local server, because the
 * demo's seeded household is the only subject that is both realistic and
 * reproducible (no live server, no real money, no flaky login).
 *
 *   bun run demo:build && bun scripts/capture-screenshots.ts
 *
 * Output: static/screenshots/*.png (manifest) and docs/screenshots/*.png
 * (README). Committed output, like the icons from gen-icons.ts — rerun on
 * redesign, not on every build.
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { cp } from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const DEMO_DIR = `${ROOT}/build-demo`;
if (!existsSync(`${DEMO_DIR}/index.html`)) {
	console.error('No build-demo/ — run `bun run demo:build` first.');
	process.exit(1);
}

// Narrow phone viewport. 540×1170 pngs; the manifest's `sizes` says so.
const VIEWPORT = { width: 540, height: 1170, deviceScaleFactor: 2 };
const WAIT_AFTER_LOAD_MS = 1200;

/** Serve the static demo with an SPA fallback (every path hydrates index.html). */
const server = Bun.serve({
	port: 0,
	async fetch(req) {
		const { pathname } = new URL(req.url);
		const clean = decodeURIComponent(pathname).replace(/\.\./g, '');
		for (const candidate of [`${DEMO_DIR}${clean}`, `${DEMO_DIR}${clean}/index.html`]) {
			const file = Bun.file(candidate);
			if (await file.exists()) return new Response(file);
		}
		return new Response(Bun.file(`${DEMO_DIR}/index.html`));
	}
});
const origin = `http://localhost:${server.port}`;

const browser = await chromium.launch();
const context = await browser.newContext({
	viewport: VIEWPORT,
	colorScheme: 'light',
	locale: 'en-US',
	timezoneId: 'UTC',
	// The app's own CSP (style-src-elem 'self') would rightly drop the injected
	// <style> below; bypassing it changes no pixels the app itself renders.
	bypassCSP: true
});
const page = await context.newPage();

// The demo banner is a fact about the demo, not about the app; a screenshot
// that says "Demo" on it sells the demo. Injected per-navigation, since a
// style added to one document dies with it.
await page.addInitScript(() => {
	const add = () => {
		const style = document.createElement('style');
		style.textContent = '.demo-banner { display: none !important; }';
		document.head.append(style);
	};
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
	else add();
});

// Establish the origin before the first shot: localStorage (theme) is set per
// subject below, and a blank document refuses it.
await page.goto(origin, { waitUntil: 'domcontentloaded' });

async function shoot(path: string, url: string, theme: 'light' | 'dark') {
	await page.evaluate((t) => {
		if (t === 'dark') localStorage.setItem('theme', 'dark');
		else localStorage.removeItem('theme');
	}, theme);
	await page.goto(`${origin}${url}`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(WAIT_AFTER_LOAD_MS);
	await page.screenshot({ path });
	console.log('wrote', path);
}

await mkdir(`${ROOT}/static/screenshots`, { recursive: true });
await mkdir(`${ROOT}/docs/screenshots`, { recursive: true });

// The ledger first: it is both a subject and the place where the app is warm,
// so the pending-approval lookup below can use the page's own origin.
await shoot(`${ROOT}/static/screenshots/ledger.png`, '/w/demo/purchases', 'light');

// A pending purchase for the approval shot. The demo's own data endpoint is
// the honest source — scraping the DOM would couple this script to markup.
const pendingId = await page.evaluate(async () => {
	const res = await fetch('/w/demo/purchases/data?limit=200');
	if (!res.ok) return null;
	const json = (await res.json()) as {
		entries: { id: string; state: string; canDecide: boolean }[];
	};
	const hit = json.entries.find((e) => e.state === 'pending_approval' && e.canDecide);
	return hit?.id ?? null;
});

if (pendingId) {
	await shoot(`${ROOT}/static/screenshots/approval.png`, `/w/demo/purchases/${pendingId}`, 'light');
} else {
	console.warn('no pending approval in the demo seed — skipped approval.png');
}
await shoot(`${ROOT}/static/screenshots/activity.png`, '/w/demo/analytics', 'dark');
await shoot(`${ROOT}/static/screenshots/new.png`, '/w/demo/purchases/new', 'dark');

// The README shows the same pictures; one subject, one set of bytes.
for (const name of ['ledger.png', 'approval.png', 'activity.png', 'new.png']) {
	if (existsSync(`${ROOT}/static/screenshots/${name}`)) {
		await cp(`${ROOT}/static/screenshots/${name}`, `${ROOT}/docs/screenshots/${name}`);
	}
}

await browser.close();
server.stop(true);
