import { expect, test } from '@playwright/test';
import {
	createInvite,
	createWorkspace,
	joinWorkspace,
	loginAs,
	newPurchase,
	setThresholdPolicy
} from './helpers';

test('approval loop: request → approve → overage re-approval → complete; deny path', async ({
	browser
}) => {
	const alice = await loginAs(browser, 'alice');
	const slug = await createWorkspace(alice, `PW Approval ${Date.now()}`);
	const code = await createInvite(alice, slug);

	const bob = await loginAs(browser, 'bob');
	await joinWorkspace(bob, code, slug);

	await setThresholdPolicy(alice, slug, 'Bob Test', '50.00', ['Alice Test']);

	// Below threshold: logs straight to completed.
	await newPurchase(bob, slug, { item: 'Cheap snacks', amount: '12.00', intent: 'log' });
	await expect(bob.locator('.chip', { hasText: 'Completed' })).toBeVisible();

	// Above threshold: pending, bob cannot decide his own request.
	const detailUrl = await newPurchase(bob, slug, {
		item: 'Mechanical keyboard',
		amount: '120.00',
		intent: 'request'
	});
	await expect(bob.locator('.chip', { hasText: 'Waiting' })).toBeVisible();
	await expect(bob.getByRole('button', { name: 'Approve' })).toHaveCount(0);

	// Alice sees the Decide queue entry and approves.
	await alice.goto(detailUrl);
	await alice.getByRole('button', { name: 'Approve' }).click();
	await expect(alice.locator('.chip', { hasText: 'Approved' })).toBeVisible();

	// Bob completes 67% over the approved amount → back to pending.
	await bob.goto(detailUrl);
	// The input is prefilled server-side and hydration re-applies that value —
	// retry the fill until it sticks. (networkidle can't be used: SSE never idles.)
	const finalAmount = bob.getByPlaceholder('Final amount');
	await expect(async () => {
		await finalAmount.fill('200.00');
		await bob.waitForTimeout(200);
		await expect(finalAmount).toHaveValue('200.00');
	}).toPass({ timeout: 15_000 });
	await bob.getByRole('button', { name: 'Complete purchase' }).click();
	await expect(bob.getByText(/needs re-approval/)).toBeVisible();

	// Alice approves the overage → completed at the real price.
	await alice.goto(detailUrl);
	await alice.getByRole('button', { name: 'Approve' }).click();
	await expect(alice.locator('.chip', { hasText: 'Completed' })).toBeVisible();
	await expect(alice.getByText('$200.00').first()).toBeVisible();

	// Deny path, with a reason that lands in the audit trail.
	const denyUrl = await newPurchase(bob, slug, {
		item: 'Gold-plated cables',
		amount: '300.00',
		intent: 'request'
	});
	await alice.goto(denyUrl);
	await alice.getByRole('button', { name: 'Deny…' }).click();
	await alice.getByPlaceholder('Reason (optional)').fill('audiophile nonsense');
	await alice.getByRole('button', { name: 'Deny request' }).click();
	await expect(alice.locator('.chip', { hasText: 'Denied' })).toBeVisible();
	await expect(alice.getByText(/audiophile nonsense/)).toBeVisible();
});
