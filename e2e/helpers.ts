import { expect, type Browser, type Page } from '@playwright/test';

export type Who = 'alice' | 'bob' | 'carol';

/** Log a fake-IdP identity in inside its own browser context. */
export async function loginAs(browser: Browser, who: Who): Promise<Page> {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.request.get(`http://localhost:9443/_as/${who}`);
	await page.goto('/auth/login');
	await page.waitForURL(/\/(welcome|w\/)/);
	return page;
}

/** Create a fresh workspace (unique per run) and return its slug. */
export async function createWorkspace(page: Page, name: string): Promise<string> {
	await page.goto('/welcome');
	await page.getByLabel('Name', { exact: true }).fill(name);
	await page.getByRole('button', { name: 'Create workspace' }).click();
	await page.waitForURL(/\/w\/[^/]+$/);
	return new URL(page.url()).pathname.split('/')[2];
}

/**
 * Owner creates an invite and reads the code.
 *
 * Invites and policies live on the Members screen. They were once on the
 * workspace dashboard, and these helpers kept pointing there long after the
 * move — which is why `approval` and `sealing` had been failing at their very
 * first step, before touching anything either test is actually about.
 */
export async function createInvite(page: Page, slug: string): Promise<string> {
	await page.goto(`/w/${slug}/settings/members`);
	// Same hydration race as the policy toggle below: a click landing before
	// the enhanced form is wired is a no-op, so retry until a code appears.
	await expect(async () => {
		if ((await page.locator('code').count()) === 0) {
			await page.getByRole('button', { name: 'New code' }).click();
		}
		await expect(page.locator('code').first()).toBeVisible({ timeout: 2000 });
	}).toPass({ timeout: 30_000 });
	return (await page.locator('code').first().innerText()).trim();
}

export async function joinWorkspace(page: Page, code: string, slug: string): Promise<void> {
	await page.goto('/welcome');
	await page.getByPlaceholder('e.g. 7XK2M9QRTB').fill(code);
	await page.getByRole('button', { name: 'Join', exact: true }).click();
	await page.waitForURL(new RegExp(`/w/${slug}$`));
}

/**
 * Click something that asks "are you sure?", and say yes.
 *
 * The gate is the app's own `ConfirmDialog`, not `window.confirm` — so
 * `page.once('dialog', …)` never fires and the action silently never happens.
 * Both this spec and `sealing` were written against the native dialog and kept
 * passing a listener nothing would ever call.
 */
export async function clickAndConfirm(page: Page, name: string | RegExp): Promise<void> {
	await page.getByRole('button', { name }).click();
	const dialog = page.getByRole('alertdialog');
	await expect(dialog).toBeVisible({ timeout: 5000 });
	await dialog.getByRole('button', { name: 'Confirm' }).click();
	await expect(dialog).toBeHidden({ timeout: 5000 });
}

/** Owner sets a member's approval policy: threshold + approver checkboxes. */
export async function setThresholdPolicy(
	page: Page,
	slug: string,
	memberName: string,
	threshold: string,
	approverNames: string[]
): Promise<void> {
	await page.goto(`/w/${slug}/settings/members`);
	// data-member wraps a member's row and its policy editor together.
	const row = page.locator(`[data-member="${memberName}"]`);
	// The toggle needs hydration; a too-early click is a no-op. Retry until
	// the form actually opens.
	//
	// Addressed by control name rather than by label: the policy editor now has
	// two selects, and their labels ("When X spends", "Bucket charges") both
	// mention approval in their options, so `getByLabel('Approval')` matched
	// both and failed on strict mode instead of on anything real.
	const approvalSelect = row.locator('select[name="mode"]');
	await expect(async () => {
		if (!(await approvalSelect.isVisible())) {
			await row.getByRole('button', { name: 'Policy', exact: true }).click();
		}
		await expect(approvalSelect).toBeVisible({ timeout: 1000 });
	}).toPass({ timeout: 15_000 });
	await approvalSelect.selectOption('threshold');
	await row.getByLabel(/Threshold/).fill(threshold);
	for (const name of approverNames) {
		await row.getByRole('checkbox', { name }).check();
	}
	await row.getByRole('button', { name: 'Save policy' }).click();
	await expect(row.getByText(/Approval above/)).toBeVisible();
}

export interface NewPurchase {
	item: string;
	amount: string;
	intent: 'log' | 'request';
	sealFrom?: string[];
	sealUntil?: string; // YYYY-MM-DD
	/** Who you paid — the field the UI labels "From". */
	merchant?: string;
	/**
	 * A maps URL for the "Where" row. Resolved entirely offline — the URL
	 * already contains its coordinates — so a test that uses this reaches no
	 * geocoder and needs none configured.
	 */
	mapLink?: string;
}

/** Turn on Places for a workspace. Owner only; the switch posts to /settings/flag. */
export async function enablePlaces(page: Page, slug: string): Promise<void> {
	/*
	 * The settings switch is *optimistic*: it flips the instant you tap and
	 * persists in the background. So asserting on `aria-checked` proves nothing —
	 * it is true before the write has landed, and navigating away at that moment
	 * aborts the in-flight POST, leaving the flag off on the server while the
	 * test believed it was on. Reload and re-read instead: the only state worth
	 * asserting here is the state that survived.
	 */
	await expect(async () => {
		await page.goto(`/w/${slug}/settings/intelligence`);
		const toggle = page.getByRole('switch', { name: 'Toggle places' });
		await expect(toggle).toBeVisible({ timeout: 2000 });
		if ((await toggle.getAttribute('aria-checked')) !== 'true') {
			await toggle.click();
			// Let the write land before the reload below cancels it.
			await page.waitForTimeout(500);
		}
		await page.reload();
		await expect(page.getByRole('switch', { name: 'Toggle places' })).toHaveAttribute(
			'aria-checked',
			'true',
			{ timeout: 2000 }
		);
	}).toPass({ timeout: 30_000 });

	await page.goto(`/w/${slug}/purchases/new`);
	await expect(placeField(page)).toBeVisible();
}

/**
 * The "Where" input, addressed by role.
 *
 * `getByLabel('Place')` matches on a substring, and the workspace switcher's
 * aria-label carries the workspace name — so any workspace whose name contains
 * "place" made that locator ambiguous and the whole spec failed on a strict-mode
 * violation rather than on anything real.
 */
export function placeField(page: Page) {
	return page.getByRole('textbox', { name: 'Place', exact: true });
}

/** Mint an API token through the settings UI and return the secret. */
export async function createApiToken(page: Page, slug: string, name: string): Promise<string> {
	await page.goto(`/w/${slug}/settings/api`);
	await page.getByLabel('Name', { exact: true }).fill(name);
	await page.getByRole('button', { name: /Create token/i }).click();
	const secret = page.locator('code', { hasText: /^ldg_/ }).first();
	await expect(secret).toBeVisible({ timeout: 15_000 });
	return (await secret.innerText()).trim();
}

/** Submit the new-purchase form; resolves to the purchase detail URL. */
export async function newPurchase(page: Page, slug: string, p: NewPurchase): Promise<string> {
	await page.goto(`/w/${slug}/purchases/new`);
	/*
	 * Wait for the form to be interactive before touching anything else.
	 *
	 * Two separate failures come from not doing this. Enter in the place field is
	 * handled in JS, which preventDefaults so the keystroke means "resolve this
	 * link" rather than "submit the purchase" — pressed too early it gets the
	 * browser's native implicit submission instead. And a click on "Log it" that
	 * lands exactly as Svelte hydrates is swallowed by the node being replaced,
	 * so the form never submits and the wait for the detail URL never resolves.
	 *
	 * "Sleep on it" enables only once Svelte's bindings are live *and* item and
	 * amount hold values, so it is an exact signal for "this form is now live".
	 * Re-filling inside the retry is the point: a `fill` that lands before
	 * hydration puts text in the DOM that the bindings never saw, so the button
	 * would stay disabled forever and waiting alone could never succeed.
	 */
	await expect(async () => {
		await page.getByLabel('Item').fill(p.item);
		await page.getByLabel(/Amount/).fill(p.amount);
		await expect(page.getByRole('button', { name: 'Sleep on it' })).toBeEnabled({
			timeout: 1000
		});
	}).toPass({ timeout: 20_000 });

	if (p.merchant) await page.getByLabel('Paid to').fill(p.merchant);
	if (p.mapLink) {
		await placeField(page).fill(p.mapLink);
		await placeField(page).press('Enter');
		// Assert on the hidden field the form will actually post, not on the text
		// beside it: that is the thing whose absence would let this test pass
		// while recording no location at all.
		await expect(page.locator('input[name="latE3"]')).toHaveCount(1);
	}
	if (p.sealFrom && p.sealFrom.length > 0) {
		await page.getByText('Gift mode — hide this purchase').click();
		for (const name of p.sealFrom) {
			await page.getByRole('checkbox', { name }).check();
		}
		await page.getByLabel(/Reveal on/).fill(p.sealUntil!);
	}
	await page
		.getByRole('button', { name: p.intent === 'log' ? 'Log it — already bought' : 'Ask first' })
		.click();
	await page.waitForURL(/\/purchases\/[0-9a-f-]+$/);
	return page.url();
}
