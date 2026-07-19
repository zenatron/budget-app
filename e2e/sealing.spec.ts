import { expect, test } from '@playwright/test';
import {
	createInvite,
	createWorkspace,
	joinWorkspace,
	loginAs,
	newPurchase,
	setThresholdPolicy
} from './helpers';

function inDays(n: number): string {
	return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}

test('sealing: concealed member sees nothing anywhere; reveal restores; conflict discloses', async ({
	browser
}) => {
	const alice = await loginAs(browser, 'alice');
	const slug = await createWorkspace(alice, `PW Sealing ${Date.now()}`);
	const code = await createInvite(alice, slug);
	const bob = await loginAs(browser, 'bob');
	await joinWorkspace(bob, code, slug);

	// Open purchase both can see + sealed purchase hidden from alice.
	await newPurchase(bob, slug, { item: 'Shared pizza', amount: '10.00', intent: 'log' });
	const giftUrl = await newPurchase(bob, slug, {
		item: 'Anniversary gift',
		amount: '30.00',
		intent: 'log',
		sealFrom: ['Alice Test'],
		sealUntil: inDays(7)
	});
	await expect(bob.getByText(/Hidden from Alice Test/)).toBeVisible();

	// List: bob sees both (with lock), alice sees only the pizza.
	await bob.goto(`/w/${slug}/purchases`);
	await expect(bob.getByText('Anniversary gift')).toBeVisible();
	await expect(bob.getByTitle('Sealed — hidden from some members')).toBeVisible();
	await alice.goto(`/w/${slug}/purchases`);
	await expect(alice.getByText('Shared pizza')).toBeVisible();
	await expect(alice.getByText('Anniversary gift')).toHaveCount(0);

	// Detail: the row does not exist for alice.
	const detailResponse = await alice.goto(giftUrl);
	expect(detailResponse!.status()).toBe(404);

	// Aggregates: alice's total excludes the sealed amount exactly.
	await alice.goto(`/w/${slug}/analytics`);
	await expect(alice.getByText('$10.00').first()).toBeVisible();
	await bob.goto(`/w/${slug}/analytics`);
	await expect(bob.getByText('$40.00').first()).toBeVisible();

	// Early reveal by the requester corrects alice's picture.
	await bob.goto(giftUrl);
	// Revealing early is destructive-ish, so the app confirms first.
	bob.once('dialog', (d) => d.accept());
	await bob.getByRole('button', { name: 'Reveal now' }).click();
	await expect(bob.getByText(/Hidden from Alice Test/)).toHaveCount(0);
	await alice.goto(`/w/${slug}/purchases`);
	await expect(alice.getByText('Anniversary gift')).toBeVisible();
	await alice.goto(`/w/${slug}/analytics`);
	await expect(alice.getByText('$40.00').first()).toBeVisible();

	// Approval × seal conflict: alice is bob's only approver; sealing from her
	// must not silently skip approval — it auto-approves WITH disclosure.
	await setThresholdPolicy(alice, slug, 'Bob Test', '50.00', ['Alice Test']);
	await newPurchase(bob, slug, {
		item: 'Surprise weekend',
		amount: '150.00',
		intent: 'request',
		sealFrom: ['Alice Test'],
		sealUntil: inDays(7)
	});
	await expect(bob.locator('.chip', { hasText: 'Approved' })).toBeVisible();
	await expect(bob.getByText(/approver concealed — recorded without approval/)).toBeVisible();
});
