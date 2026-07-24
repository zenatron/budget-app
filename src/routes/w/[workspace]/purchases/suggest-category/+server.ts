import { error, json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { listCategories } from '$lib/server/repo/workspaces';
import { getLlmAssist } from '$lib/infra/llm';
import type { RequestHandler } from './$types';

/**
 * The first proving ground for the assist layer: suggest a category for a
 * purchase from its item name (and merchant, if given). Deterministic-first —
 * with AI off, or on any failure, this returns { categoryId: null } and the
 * form behaves exactly as it always has. A suggestion is never applied here; the
 * client shows it as a chip the person taps to accept.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.workspace!.intelligenceEnabled) error(403, 'Harmony is not enabled');
	const ws = locals.workspace!;
	const assist = getLlmAssist({
		aiMode: ws.aiMode,
		aiEndpoint: ws.aiEndpoint,
		aiModel: ws.aiModel,
		aiApiKey: ws.aiApiKey
	});
	if (!assist.available) return json({ categoryId: null });

	const body = await request.json().catch(() => ({}));
	const itemName = typeof body?.itemName === 'string' ? body.itemName.trim().slice(0, 120) : '';
	const merchantName =
		typeof body?.merchantName === 'string' ? body.merchantName.trim().slice(0, 200) : '';
	if (!itemName) return json({ categoryId: null });

	const categories = await listCategories(getDb(), ws.id);
	if (categories.length === 0) return json({ categoryId: null });

	const choices = categories.map((c) => ({ id: c.id, label: c.name }));
	const text = merchantName ? `${itemName} (from ${merchantName})` : itemName;
	const categoryId = await assist.pickChoice({
		instruction: 'Pick the spending category that best fits this purchase.',
		text,
		choices
	});

	const match = categoryId ? categories.find((c) => c.id === categoryId) : null;
	return json({
		categoryId: match?.id ?? null,
		name: match?.name ?? null,
		icon: match?.icon ?? null
	});
};
