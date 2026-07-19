/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />
import { build, files, version } from '$service-worker';
import { resolveDeepLink, type DeepLinkPayload } from '$lib/deep-link';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `assets-${version}`;
const ASSETS = new Set([...build, ...files]);

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll([...ASSETS]))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys.filter((k) => k !== CACHE && k !== `pages-${version}`).map((k) => caches.delete(k))
				)
			)
			.then(() => sw.clients.claim())
	);
});

const PAGES = `pages-${version}`;

// Immutable build assets from cache. Navigations are network-first with the
// last successful copy as an offline fallback — read-only offline by design
// (iOS has no Background Sync, so there is no write queue to build).
sw.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;
	const url = new URL(event.request.url);
	if (url.origin !== sw.location.origin) return;

	if (ASSETS.has(url.pathname)) {
		event.respondWith(
			caches.open(CACHE).then(async (cache) => {
				const hit = await cache.match(event.request);
				return hit ?? fetch(event.request);
			})
		);
		return;
	}

	if (event.request.mode === 'navigate') {
		event.respondWith(
			(async () => {
				const cache = await caches.open(PAGES);
				try {
					const fresh = await fetch(event.request);
					if (fresh.ok) cache.put(event.request, fresh.clone());
					return fresh;
				} catch {
					const cached = await cache.match(event.request);
					return (
						cached ??
						new Response('<h1>Offline</h1><p>Reconnect to see your workspace.</p>', {
							status: 503,
							headers: { 'Content-Type': 'text/html' }
						})
					);
				}
			})()
		);
	}
});

interface PushPayload extends DeepLinkPayload {
	title?: string;
	body?: string;
	tag?: string;
}

sw.addEventListener('push', (event) => {
	let payload: PushPayload;
	try {
		payload = event.data?.json() ?? {};
	} catch {
		payload = { body: event.data?.text() };
	}
	event.waitUntil(
		sw.registration.showNotification(payload.title ?? 'Ledger', {
			body: payload.body,
			tag: payload.tag,
			icon: '/icons/icon-192.png',
			badge: '/icons/icon-192.png',
			data: { url: resolveDeepLink(payload, sw.location.origin) }
		})
	);
});

// Notifications are deep links, not action surfaces (iOS action support is thin).
sw.addEventListener('notificationclick', (event) => {
	event.notification.close();
	// Same-origin by construction: stored as a path, resolved here.
	const url = new URL(event.notification.data?.url ?? '/', sw.location.origin).href;
	event.waitUntil(
		sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
			for (const client of clients) {
				if (client.url.startsWith(sw.location.origin)) {
					client.navigate(url);
					return client.focus();
				}
			}
			return sw.clients.openWindow(url);
		})
	);
});
