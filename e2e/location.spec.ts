import { expect, test } from '@playwright/test';
import {
	clickAndConfirm,
	createApiToken,
	createInvite,
	createWorkspace,
	enablePlaces,
	joinWorkspace,
	loginAs,
	newPurchase,
	placeField
} from './helpers';

/*
 * Longer than the 180s default. This spec drives two identities through four
 * purchases, an MCP call and an unseal, each behind the hydration retries the
 * form needs — it outgrew the shared budget and failed on the clock rather than
 * on anything it was testing.
 */
test.describe.configure({ timeout: 360_000 });

function inDays(n: number): string {
	return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}

// Two pins far enough apart that no zoom level could cluster them together.
const SF = 'https://www.google.com/maps/@37.7749,-122.4194,15z';
const LONDON = 'https://www.google.com/maps/@51.5074,-0.1278,15z';

/**
 * The seal has to hold on every surface a place can reach, not just the ledger.
 *
 * A location is the most sensitive thing this app stores, and it now flows to
 * three places the seal filter has to cover independently: the map's point
 * feed, the "By place" breakdown on Activity, and the `spending_by_place` MCP
 * tool. All three route through the same `spentInPeriod` predicate — this test
 * is what keeps that true, because the cost of one of them growing its own
 * query is a concealed member learning where a gift was bought.
 */
test('places: a sealed purchase leaks no pin — not on the map, not in By place, not over MCP', async ({
	browser
}) => {
	const alice = await loginAs(browser, 'alice');
	const slug = await createWorkspace(alice, `PW Pins ${Date.now()}`);
	await enablePlaces(alice, slug);
	const code = await createInvite(alice, slug);
	const bob = await loginAs(browser, 'bob');
	await joinWorkspace(bob, code, slug);

	// One pinned purchase both can see, one pinned purchase hidden from Alice.
	await newPurchase(bob, slug, {
		item: 'Shared coffee',
		amount: '10.00',
		intent: 'log',
		mapLink: SF
	});
	await newPurchase(bob, slug, {
		item: 'Anniversary gift',
		amount: '300.00',
		intent: 'log',
		mapLink: LONDON,
		sealFrom: ['Alice Test'],
		sealUntil: inDays(7)
	});

	// Bob sees both places.
	await bob.goto(`/w/${slug}/analytics`);
	await expect(bob.getByText('By place')).toBeVisible();

	// ── The map ────────────────────────────────────────────────────────────
	// Assert on the point feed rather than on rendered pixels: a bubble can be
	// off-screen or clustered, but a coordinate in the payload has already
	// escaped whatever the canvas does with it.
	const alicePoints = await alice.evaluate(async (s) => {
		const res = await fetch(`/w/${s}/analytics/map`, {
			headers: { accept: 'text/html' }
		});
		return res.text();
	}, slug);
	// 51.507 is London in millidegrees; the sealed pin must appear nowhere in
	// what the server sent her, in any form.
	expect(alicePoints).not.toContain('51507');
	expect(alicePoints).not.toContain('Anniversary gift');
	// And the one she may see is there.
	expect(alicePoints).toContain('37775');

	const bobPoints = await bob.evaluate(async (s) => {
		const res = await fetch(`/w/${s}/analytics/map`, { headers: { accept: 'text/html' } });
		return res.text();
	}, slug);
	expect(bobPoints).toContain('51507');

	// ── By place, on Activity ──────────────────────────────────────────────
	await alice.goto(`/w/${slug}/analytics`);
	// Her total is the shared coffee alone — the sealed £300 is not in it.
	await expect(alice.getByText('$10.00').first()).toBeVisible();
	await expect(alice.getByText('$310.00')).toHaveCount(0);

	// ── The MCP tool ───────────────────────────────────────────────────────
	// A token belongs to a member, so Alice's token sees exactly what Alice sees.
	const token = await createApiToken(alice, slug, 'places-seal-check');
	const mcp = await alice.request.post('/mcp', {
		headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
		data: {
			jsonrpc: '2.0',
			id: 1,
			method: 'tools/call',
			params: { name: 'spending_by_place', arguments: { period: 'this_month' } }
		}
	});
	const body = JSON.stringify(await mcp.json());
	expect(body).not.toContain('51.507');
	expect(body).not.toContain('Anniversary gift');
	expect(body).toContain('37.775');

	// ── Revealing corrects every surface at once ───────────────────────────
	await bob.goto(`/w/${slug}/purchases`);
	await bob.getByText('Anniversary gift').click();
	await bob.waitForURL(/\/purchases\/[0-9a-f-]+$/);
	await clickAndConfirm(bob, 'Reveal now');
	await expect(bob.getByText(/Hidden from Alice Test/)).toHaveCount(0);

	const afterReveal = await alice.evaluate(async (s) => {
		const res = await fetch(`/w/${s}/analytics/map`, { headers: { accept: 'text/html' } });
		return res.text();
	}, slug);
	expect(afterReveal).toContain('51507');
});

test('places: the row is absent, and a hand-posted pin is dropped, when places are off', async ({
	browser
}) => {
	const alice = await loginAs(browser, 'alice');
	const slug = await createWorkspace(alice, `PW NoPins ${Date.now()}`);

	// Default is off: an off feature leaves no field on the form.
	await alice.goto(`/w/${slug}/purchases/new`);
	await expect(placeField(alice)).toHaveCount(0);

	// And the flag is enforced at the application layer, not just in the markup,
	// so a request that skips the form entirely still writes no pin.
	const posted = await alice.evaluate(async (s) => {
		const fd = new FormData();
		fd.set('itemName', 'Hand-posted pin');
		fd.set('amount', '1.00');
		fd.set('intent', 'log');
		fd.set('latE3', '51507');
		fd.set('lngE3', '-128');
		fd.set('locationSource', 'device');
		const res = await fetch(`/w/${s}/purchases/new`, {
			method: 'POST',
			body: fd,
			headers: { 'x-sveltekit-action': 'true' }
		});
		return res.status;
	}, slug);
	expect(posted).toBe(200);

	// The purchase exists; the pin does not. The map refuses outright.
	await alice.goto(`/w/${slug}/purchases`);
	await expect(alice.getByText('Hand-posted pin')).toBeVisible();
	const map = await alice.goto(`/w/${slug}/analytics/map`);
	expect(map!.status()).toBe(403);
});

/**
 * The write path can leak what the read path cannot.
 *
 * `merchant` rows are workspace-global and carry no seal of their own — which
 * every read handles by entering through `purchase`. But a vendor that *learned*
 * its location from a sealed gift would hand that location straight to the
 * concealed member through the next unsealed purchase at the same vendor. Only
 * the write path can prevent that, by declining to learn.
 */
test('places: a sealed purchase does not teach its vendor a pin', async ({ browser }) => {
	const alice = await loginAs(browser, 'alice');
	const slug = await createWorkspace(alice, `PW Vendor ${Date.now()}`);
	await enablePlaces(alice, slug);
	const code = await createInvite(alice, slug);
	const bob = await loginAs(browser, 'bob');
	await joinWorkspace(bob, code, slug);

	await newPurchase(bob, slug, {
		item: 'Ring',
		amount: '900.00',
		intent: 'log',
		merchant: 'Hatton Garden Jewellers',
		mapLink: LONDON,
		sealFrom: ['Alice Test'],
		sealUntil: inDays(7)
	});
	// Same vendor, no pin of its own, not sealed. It must inherit nothing.
	await newPurchase(bob, slug, {
		item: 'Polishing cloth',
		amount: '5.00',
		intent: 'log',
		merchant: 'Hatton Garden Jewellers'
	});

	const aliceSees = await alice.evaluate(async (s) => {
		const res = await fetch(`/w/${s}/analytics/map`, { headers: { accept: 'text/html' } });
		return res.text();
	}, slug);
	expect(aliceSees).not.toContain('51507');
	expect(aliceSees).not.toContain('Ring');
});
