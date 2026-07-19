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

/** Owner creates an invite on the dashboard and reads the code. */
export async function createInvite(page: Page, slug: string): Promise<string> {
	await page.goto(`/w/${slug}`);
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

/** Owner sets a member's approval policy: threshold + approver checkboxes. */
export async function setThresholdPolicy(
	page: Page,
	slug: string,
	memberName: string,
	threshold: string,
	approverNames: string[]
): Promise<void> {
	await page.goto(`/w/${slug}`);
	// data-member wraps a member's row and its policy editor together.
	const row = page.locator(`[data-member="${memberName}"]`);
	// The toggle needs hydration; a too-early click is a no-op. Retry until
	// the form actually opens.
	const approvalSelect = row.getByLabel('Approval');
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
}

/** Submit the new-purchase form; resolves to the purchase detail URL. */
export async function newPurchase(page: Page, slug: string, p: NewPurchase): Promise<string> {
	await page.goto(`/w/${slug}/purchases/new`);
	await page.getByLabel('Item').fill(p.item);
	await page.getByLabel(/Amount/).fill(p.amount);
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
