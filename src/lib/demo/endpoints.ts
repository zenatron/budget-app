import { json } from '@sveltejs/kit';
import { getDemoContext } from './context';
import type { WorkspaceContext } from '$lib/ports/context';

import * as ledgerData from '../../routes/w/[workspace]/purchases/data/handlers';
import * as flag from '../../routes/w/[workspace]/settings/flag/handlers';
import * as memberFlag from '../../routes/w/[workspace]/settings/member-flag/handlers';
import * as memberPref from '../../routes/w/[workspace]/settings/member-pref/handlers';

/* eslint-disable @typescript-eslint/no-explicit-any */
type EndpointHandler = (ctx: WorkspaceContext, event: any) => Promise<Response>;

/**
 * The app's endpoint transport, served in the tab.
 *
 * Not everything the UI does goes through a form. The ledger pages with a plain
 * `fetch`, and the settings switches POST JSON rather than submitting — a
 * deliberate choice (see Toggle.svelte), but it means `use:submit` never sees
 * them. Without this they hit the static host, which under the SPA rewrite
 * answers `200` with `index.html`: a success status carrying HTML, so the
 * calling code fails on parse rather than on a status check. Silent breakage,
 * which is exactly how it reached a deployed demo.
 *
 * Matched on the path after `/w/<slug>`, since the slug varies.
 */
const ROUTES: Array<{ path: string; method: string; handler: EndpointHandler }> = [
	{ path: 'purchases/data', method: 'GET', handler: ledgerData.GET },
	{ path: 'settings/flag', method: 'POST', handler: flag.POST },
	{ path: 'settings/member-flag', method: 'POST', handler: memberFlag.POST },
	{ path: 'settings/member-pref', method: 'POST', handler: memberPref.POST }
];

/** Endpoints the demo answers without a handler, because the capability behind
 *  them is switched off rather than missing. */
const STUBS: Array<{ path: string; reply: () => Response }> = [
	// The geocoder is off (see demoDeps), so the honest answer is "no matches"
	// rather than an error the place field would surface as a failure.
	{ path: 'places/search', reply: () => json({ results: [] }) }
];

const WORKSPACE_PATH = /^\/w\/[^/]+\/(.*)$/;

function match(url: URL, method: string) {
	const rest = WORKSPACE_PATH.exec(url.pathname)?.[1];
	if (!rest) return null;
	const route = ROUTES.find((r) => r.path === rest && r.method === method);
	if (route) return { kind: 'handler' as const, route };
	const stub = STUBS.find((s) => s.path === rest);
	if (stub) return { kind: 'stub' as const, stub };
	return null;
}

let installed = false;

/**
 * Route the app's own endpoint calls to local handlers.
 *
 * Patching `fetch` rather than changing ~10 call sites, for the same reason the
 * form path hooks `use:submit`: one seam the demo controls, and no per-feature
 * divergence to keep in step with the real app.
 */
export function installDemoEndpoints(base = ''): void {
	if (installed || typeof window === 'undefined') return;
	installed = true;

	const original = window.fetch.bind(window);

	window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
		let url: URL;
		let method = init?.method ?? 'GET';
		try {
			if (input instanceof Request) {
				url = new URL(input.url);
				method = init?.method ?? input.method;
			} else {
				url = new URL(String(input), window.location.origin);
			}
		} catch {
			return original(input as RequestInfo, init);
		}

		if (url.origin !== window.location.origin) return original(input as RequestInfo, init);

		const hit = match(url, method.toUpperCase());
		if (!hit) return original(input as RequestInfo, init);

		if (hit.kind === 'stub') return hit.stub.reply();

		try {
			const ctx = await getDemoContext(base);
			const request = input instanceof Request ? input : new Request(url, init);
			return await hit.route.handler(ctx, { request, url });
		} catch (e) {
			// Mirror the server: a thrown error becomes a response, not a rejected
			// fetch, so the caller's own error handling still applies.
			const status = (e as { status?: number })?.status ?? 500;
			return json({ message: (e as Error)?.message ?? 'Demo endpoint failed' }, { status });
		}
	};
}
