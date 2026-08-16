/**
 * Suggest a spending category for a purchase.
 *
 * Two doors reach this — the "Describe it, or dictate" box and the item/merchant
 * blur on the Add form — and both used to build their own `pickChoice` call from
 * a bare item name. That threw away nearly everything that decides the answer,
 * and then asked a small local model to make up the difference. This module is
 * the one place the question is asked, and it asks it in two stages:
 *
 * 1. **What did you file this merchant under last time?** Deterministic, one
 *    indexed query, no model, works with AI switched off, and it gets better the
 *    more you use the app. A household buys from the same twenty places over and
 *    over, so this answers most of the real traffic.
 *
 * 2. **Only for a merchant we have never seen**, ask the model — but give it the
 *    whole sentence, the merchant, the amount, category paths rather than a
 *    flattened list, and worked examples.
 *
 * The stance is unchanged from everywhere else in the assist layer: this returns
 * a *suggestion* that lands in a form field the person confirms. A miss costs a
 * tap. Nothing here writes anything.
 */

import type { Db } from '$lib/db/types';
import type { LlmAssist } from '$lib/ports/llm-assist';
import { listCategories } from '$lib/repo/workspaces';
import { lastCategoryForMerchant } from '$lib/repo/purchases';
import { normalizeMerchantName } from '$lib/domain/purchase/merchant';

type CategoryRow = Awaited<ReturnType<typeof listCategories>>[number];

export interface SuggestCategoryCmd {
	/** The item as parsed or typed. */
	itemName: string;
	merchantName?: string | null;
	/** Decimal amount string, when one is known. Context for the model only. */
	amount?: string | null;
	/**
	 * The original sentence, when this came from the describe box. The model sees
	 * this rather than the residual item name: "23 on lunch at Chipotle" says far
	 * more about the category than "lunch" does on its own.
	 */
	sentence?: string | null;
}

export interface CategorySuggestion {
	categoryId: string | null;
	name: string | null;
	icon: string | null;
	/**
	 * Where the answer came from. 'memory' is a fact about this workspace's own
	 * history; 'model' is a guess. Callers may present them differently, and it
	 * makes the two stages visible in tests.
	 */
	source: 'memory' | 'model' | null;
}

const NONE: CategorySuggestion = { categoryId: null, name: null, icon: null, source: null };

/**
 * Label a category by its full path, so a nested "Groceries" under "Food" is not
 * offered to the model as an identical twin of some other "Groceries". Only one
 * level up is walked: deeper nesting is not something the app creates, and a
 * long path is harder for a small model to copy back exactly.
 */
function pathLabel(c: CategoryRow, byId: Map<string, CategoryRow>): string {
	const parent = c.parentId ? byId.get(c.parentId) : null;
	return parent ? `${parent.name} > ${c.name}` : c.name;
}

/**
 * Examples chosen to teach the two things the classifier most often got wrong:
 * that the merchant usually decides the answer, and that abstaining is a real
 * option rather than a failure.
 */
const EXAMPLES = [
	{ text: 'weekly shop at Tesco', answer: 'Groceries' },
	{ text: 'flat white at Blue Bottle', answer: 'Dining' },
	{ text: 'monthly Spotify charge', answer: 'Subscriptions' },
	{ text: 'thing', answer: 'NONE' }
];

export async function suggestCategory(
	db: Db,
	assist: LlmAssist,
	workspaceId: string,
	cmd: SuggestCategoryCmd
): Promise<CategorySuggestion> {
	const itemName = cmd.itemName.trim();
	const merchantName = (cmd.merchantName ?? '').trim();
	if (!itemName && !merchantName) return NONE;

	const categories = await listCategories(db, workspaceId);
	if (categories.length === 0) return NONE;
	const byId = new Map(categories.map((c) => [c.id, c]));
	const found = (id: string, source: 'memory' | 'model'): CategorySuggestion => {
		const c = byId.get(id);
		return c ? { categoryId: c.id, name: c.name, icon: c.icon, source } : NONE;
	};

	// 1. Memory. Runs even with the assist off — it is our own data, not a model.
	if (merchantName) {
		const remembered = await lastCategoryForMerchant(
			db,
			workspaceId,
			normalizeMerchantName(merchantName)
		);
		if (remembered && byId.has(remembered)) return found(remembered, 'memory');
	}

	// 2. The model, for merchants this workspace has no history with.
	if (!assist.available) return NONE;

	const choices = categories.map((c) => ({ id: c.id, label: pathLabel(c, byId) }));
	const picked = await assist.pickChoice({
		instruction: 'Pick the spending category that best fits this purchase.',
		text: cmd.sentence?.trim() || (merchantName ? `${itemName} at ${merchantName}` : itemName),
		context: [
			{ label: 'Item', value: itemName },
			{ label: 'Merchant', value: merchantName },
			{ label: 'Amount', value: cmd.amount ?? '' }
		],
		examples: EXAMPLES,
		choices
	});

	// constrainToChoice already refused anything invented, but the id is looked up
	// against the real rows once more before it leaves here — the same belt and
	// braces the parse endpoint used to do inline.
	return picked && byId.has(picked) ? found(picked, 'model') : NONE;
}
