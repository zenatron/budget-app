import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Db } from '$lib/db/types';
import { fakeAssist } from '$lib/ports/fake-assist';
import type { LlmAssist } from '$lib/ports/llm-assist';

/**
 * The two-stage design is the thing under test, and the interesting half of it
 * runs with no model at all. Both repository calls are stubbed, so what's left
 * is exactly the decision: memory first, model only for a merchant we've never
 * seen, and nothing accepted that isn't one of our own category rows.
 */
const listCategories = vi.fn();
const lastCategoryForMerchant = vi.fn();

vi.mock('$lib/repo/workspaces', () => ({
	listCategories: (...a: unknown[]) => listCategories(...a)
}));
vi.mock('$lib/repo/purchases', () => ({
	lastCategoryForMerchant: (...a: unknown[]) => lastCategoryForMerchant(...a)
}));

const { suggestCategory } = await import('./suggest-category');

const db = {} as Db;
const WS = 'ws-1';

const CATEGORIES = [
	{ id: 'c-food', name: 'Food', icon: '🍽', parentId: null },
	{ id: 'c-groceries', name: 'Groceries', icon: '🛒', parentId: 'c-food' },
	{ id: 'c-dining', name: 'Dining', icon: '🍜', parentId: 'c-food' }
];

beforeEach(() => {
	listCategories.mockReset().mockResolvedValue(CATEGORIES);
	lastCategoryForMerchant.mockReset().mockResolvedValue(null);
});

describe('suggestCategory — stage 1, this workspace’s own history', () => {
	it('answers from merchant memory with the assist switched off', async () => {
		lastCategoryForMerchant.mockResolvedValue('c-groceries');

		const out = await suggestCategory(db, fakeAssist({ available: false }), WS, {
			itemName: 'weekly shop',
			merchantName: 'Tesco'
		});

		expect(out).toEqual({
			categoryId: 'c-groceries',
			name: 'Groceries',
			icon: '🛒',
			source: 'memory'
		});
	});

	it('never asks the model when memory answered', async () => {
		lastCategoryForMerchant.mockResolvedValue('c-dining');
		const pickChoice = vi.fn(async () => 'c-groceries');

		const out = await suggestCategory(db, fakeAssist({ pickChoice }), WS, {
			itemName: 'flat white',
			merchantName: 'Blue Bottle'
		});

		expect(out.source).toBe('memory');
		expect(out.categoryId).toBe('c-dining');
		expect(pickChoice).not.toHaveBeenCalled();
	});

	it('falls through to the model when the remembered category no longer exists', async () => {
		lastCategoryForMerchant.mockResolvedValue('c-deleted');
		const pickChoice = vi.fn(async () => 'c-dining');

		const out = await suggestCategory(db, fakeAssist({ pickChoice }), WS, {
			itemName: 'lunch',
			merchantName: 'Chipotle'
		});

		expect(out.source).toBe('model');
		expect(out.categoryId).toBe('c-dining');
	});
});

describe('suggestCategory — stage 2 is skipped unless a model is really there', () => {
	it('returns nothing rather than guessing when the assist is unavailable', async () => {
		const pickChoice = vi.fn(async () => 'c-dining');

		const out = await suggestCategory(db, fakeAssist({ available: false, pickChoice }), WS, {
			itemName: 'lunch',
			merchantName: 'Chipotle'
		});

		expect(out).toEqual({ categoryId: null, name: null, icon: null, source: null });
		expect(pickChoice).not.toHaveBeenCalled();
	});

	it('offers nested categories by path, so two “Groceries” could not be confused', async () => {
		const pickChoice = vi.fn<LlmAssist['pickChoice']>(async () => 'c-groceries');

		await suggestCategory(db, fakeAssist({ pickChoice }), WS, {
			itemName: 'weekly shop',
			merchantName: 'Tesco'
		});

		const req = pickChoice.mock.calls[0][0];
		expect(req.choices).toContainEqual({ id: 'c-groceries', label: 'Food > Groceries' });
		expect(req.choices).toContainEqual({ id: 'c-food', label: 'Food' });
	});

	it('sends the whole sentence when one is available, not the residual item', async () => {
		const pickChoice = vi.fn<LlmAssist['pickChoice']>(async () => null);

		await suggestCategory(db, fakeAssist({ pickChoice }), WS, {
			itemName: 'lunch',
			merchantName: 'Chipotle',
			sentence: '23 on lunch at Chipotle'
		});

		const req = pickChoice.mock.calls[0][0];
		expect(req.text).toBe('23 on lunch at Chipotle');
	});
});

describe('suggestCategory — nothing invented survives', () => {
	it('drops a model answer that is not one of our category ids', async () => {
		const out = await suggestCategory(
			db,
			fakeAssist({ pickChoice: async () => 'Groceries, obviously' }),
			WS,
			{ itemName: 'lunch', merchantName: 'Chipotle' }
		);

		expect(out).toEqual({ categoryId: null, name: null, icon: null, source: null });
	});

	it('abstains when the model abstains', async () => {
		const out = await suggestCategory(db, fakeAssist({ pickChoice: async () => null }), WS, {
			itemName: 'thing'
		});
		expect(out.source).toBeNull();
	});

	it('asks nothing at all when there is neither an item nor a merchant', async () => {
		const pickChoice = vi.fn(async () => 'c-dining');
		const out = await suggestCategory(db, fakeAssist({ pickChoice }), WS, { itemName: '  ' });

		expect(out.source).toBeNull();
		expect(listCategories).not.toHaveBeenCalled();
		expect(pickChoice).not.toHaveBeenCalled();
	});

	it('abstains when the workspace has no categories to choose from', async () => {
		listCategories.mockResolvedValue([]);
		const pickChoice = vi.fn(async () => 'c-dining');

		const out = await suggestCategory(db, fakeAssist({ pickChoice }), WS, { itemName: 'lunch' });

		expect(out.source).toBeNull();
		expect(pickChoice).not.toHaveBeenCalled();
	});
});
