import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { listCategories } from '$lib/server/repo/workspaces';
import { getLlmAssist } from '$lib/infra/llm';
import { parsePurchaseText } from '$lib/domain/intelligence/parse-purchase';
import { calDateInZone } from '$lib/domain/time/zoned';
import { addDays } from '$lib/domain/recurrence/rrule';
import { systemClock } from '$lib/infra/time/system-clock';
import type { RequestHandler } from './$types';

/**
 * Turn a spoken/typed sentence into purchase fields for the Add form. Money and
 * date come only from the deterministic parser; the optional assist adds only a
 * category. Nothing is submitted — the client fills the form, the person confirms.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const ws = locals.workspace!;
	const body = await request.json().catch(() => ({}));
	const text = typeof body?.text === 'string' ? body.text.slice(0, 300) : '';
	if (!text.trim()) return json({ empty: true });

	const parsed = parsePurchaseText(text);

	// Deterministic date → a YYYY-MM-DD the form can back-date with.
	const pad = (n: number) => String(n).padStart(2, '0');
	let spentAt: string | null = null;
	if (parsed.dateOffsetDays < 0) {
		const d = addDays(calDateInZone(systemClock.now(), ws.timezone), parsed.dateOffsetDays);
		spentAt = `${d.y}-${pad(d.m)}-${pad(d.d)}`;
	}

	// Optional: a category suggestion, constrained to the workspace's own set.
	let categoryId: string | null = null;
	let categoryName: string | null = null;
	const assist = getLlmAssist({
		aiMode: ws.aiMode,
		aiEndpoint: ws.aiEndpoint,
		aiModel: ws.aiModel,
		aiApiKey: ws.aiApiKey
	});
	if (assist.available && parsed.itemName) {
		const categories = await listCategories(getDb(), ws.id);
		if (categories.length > 0) {
			const picked = await assist.pickChoice({
				instruction: 'Pick the spending category that best fits this purchase.',
				text: parsed.merchantName ? `${parsed.itemName} (from ${parsed.merchantName})` : parsed.itemName,
				choices: categories.map((c) => ({ id: c.id, label: c.name }))
			});
			const match = picked ? categories.find((c) => c.id === picked) : null;
			categoryId = match?.id ?? null;
			categoryName = match?.name ?? null;
		}
	}

	return json({
		amount: parsed.amount,
		itemName: parsed.itemName,
		merchantName: parsed.merchantName,
		intent: parsed.intent,
		dateOffsetDays: parsed.dateOffsetDays,
		dateLabel: parsed.dateLabel,
		spentAt,
		categoryId,
		categoryName
	});
};
