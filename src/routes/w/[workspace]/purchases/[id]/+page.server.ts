import { eq } from 'drizzle-orm';
import { error, fail } from '@sveltejs/kit';
import * as v from 'valibot';
import { Money, InvalidMoneyError } from '$lib/domain/money/money';
import { PurchaseStateError } from '$lib/domain/purchase/purchase';
import { isStale, waitingDays } from '$lib/domain/approval/staleness';
import { isSealed } from '$lib/domain/visibility/seal';
import { addPurchaseImage, listImages } from '$lib/application/images';
import { ImageValidationError } from '$lib/infra/images/process';
import { getBlobStore } from '$lib/server/blobs';
import {
	PurchaseNotFoundError,
	approvePurchase,
	cancelPurchase,
	completePurchase,
	denyPurchase,
	editPurchase,
	refundPurchase,
	unsealPurchase
} from '$lib/application/purchases';
import { getDb } from '$lib/server/db';
import { listEvents, loadPurchase, memberNames } from '$lib/server/repo/purchases';
import { listCategories } from '$lib/server/repo/workspaces';
import { merchant } from '$lib/server/db/schema';
import { uuidv7 } from '$lib/infra/id/uuidv7';
import { systemClock } from '$lib/infra/time/system-clock';
import { getNotifier } from '$lib/server/notify';
import type { Actions, PageServerLoad } from './$types';

const deps = {
	clock: systemClock,
	ids: uuidv7,
	get notifier() {
		return getNotifier();
	}
};

export const load: PageServerLoad = async ({ locals, params }) => {
	const db = getDb();
	const now = systemClock.now();
	const scope = { workspaceId: locals.workspace!.id, viewerId: locals.member!.id };
	const p = await loadPurchase(db, scope, params.id, { now });
	if (!p) error(404, 'Not found');

	const [events, names, categories, images] = await Promise.all([
		listEvents(db, p.id),
		memberNames(db, [p.memberId, ...p.approverMemberIds, ...p.sealedFromMemberIds]),
		listCategories(db, locals.workspace!.id),
		listImages(db, scope, p.id, now)
	]);

	let merchantName: string | null = null;
	if (p.merchantId) {
		const [m] = await db
			.select({ name: merchant.name })
			.from(merchant)
			.where(eq(merchant.id, p.merchantId))
			.limit(1);
		merchantName = m?.name ?? null;
	}

	const mine = p.memberId === locals.member!.id;
	const pending = p.state === 'pending_approval';
	const sealed = isSealed(p, now);
	return {
		purchase: {
			id: p.id,
			state: p.state,
			itemName: p.itemName,
			note: p.note,
			categoryId: p.categoryId,
			merchantName,
			requestedAmountMinor: p.requestedAmount.minor,
			approvedAmountMinor: p.approvedAmount?.minor ?? null,
			finalAmountMinor: p.finalAmount?.minor ?? null,
			currency: p.requestedAmount.currency,
			requesterName: names.get(p.memberId) ?? 'Unknown',
			approverNames: p.approverMemberIds.map((id) => names.get(id) ?? 'Unknown'),
			requestedAt: p.requestedAt?.toISOString() ?? null,
			completedAt: p.completedAt?.toISOString() ?? null,
			stale:
				pending &&
				p.requestedAt !== null &&
				isStale(p.requestedAt, locals.workspace!.staleAfterHours, now),
			waitingDays: pending && p.requestedAt !== null ? waitingDays(p.requestedAt, now) : 0,
			isOverageReapproval: pending && p.finalAmount !== null,
			sealed,
			sealedUntil: sealed ? p.sealedUntil!.toISOString() : null,
			sealedFromNames: sealed ? p.sealedFromMemberIds.map((id) => names.get(id) ?? 'Unknown') : []
		},
		can: {
			decide: pending && p.approverMemberIds.includes(locals.member!.id),
			complete: p.state === 'approved' && mine,
			cancel: mine && ['draft', 'pending_approval', 'approved'].includes(p.state),
			edit: mine && ['draft', 'pending_approval', 'approved'].includes(p.state),
			// Photos (receipts) can be attached in any state the requester owns.
			addPhoto: mine && p.state !== 'cancelled',
			unseal: mine && sealed,
			refund: mine && p.state === 'completed' && !sealed && p.parentPurchaseId === null
		},
		images: images.map((i) => ({
			id: i.id,
			blobId: i.blobId,
			thumbBlobId: i.thumbBlobId,
			width: i.width,
			height: i.height
		})),
		events: events.map((e) => ({
			toState: e.toState,
			actorName: e.actorName,
			reason: e.reason,
			amountMinor: e.amountMinor,
			at: e.at.toISOString()
		})),
		categories: categories.map((c) => ({ id: c.id, name: c.name, icon: c.icon }))
	};
};

function scopeOf(locals: App.Locals) {
	return { workspaceId: locals.workspace!.id, memberId: locals.member!.id };
}

async function run(fn: () => Promise<void>) {
	try {
		await fn();
	} catch (e) {
		if (e instanceof PurchaseNotFoundError) error(404, 'Not found');
		if (e instanceof PurchaseStateError || e instanceof InvalidMoneyError) {
			return fail(400, { error: e.message });
		}
		throw e;
	}
	return null;
}

export const actions: Actions = {
	approve: async ({ locals, params }) =>
		run(() => approvePurchase(getDb(), deps, scopeOf(locals), params.id)),

	deny: async ({ locals, params, request }) => {
		const reason = String((await request.formData()).get('reason') ?? '').trim() || null;
		return run(() => denyPurchase(getDb(), deps, scopeOf(locals), params.id, reason));
	},

	cancel: async ({ locals, params }) =>
		run(() => cancelPurchase(getDb(), deps, scopeOf(locals), params.id)),

	unseal: async ({ locals, params }) =>
		run(() => unsealPurchase(getDb(), deps, scopeOf(locals), params.id)),

	refund: async ({ locals, params, request }) => {
		const raw = String((await request.formData()).get('refundAmount') ?? '').trim();
		return run(() =>
			refundPurchase(
				getDb(),
				deps,
				scopeOf(locals),
				params.id,
				Money.fromDecimal(raw, locals.workspace!.currency)
			)
		);
	},

	addImage: async ({ locals, params, request }) => {
		const form = await request.formData();
		const file = form.get('photo');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { error: 'Pick a photo first' });
		}
		try {
			await addPurchaseImage(
				getDb(),
				{ ...deps, blobs: getBlobStore() },
				scopeOf(locals),
				params.id,
				new Uint8Array(await file.arrayBuffer())
			);
		} catch (e) {
			if (e instanceof PurchaseNotFoundError) error(404, 'Not found');
			if (e instanceof ImageValidationError || e instanceof PurchaseStateError) {
				return fail(400, { error: e.message });
			}
			throw e;
		}
		return null;
	},

	complete: async ({ locals, params, request }) => {
		const form = await request.formData();
		const amountRaw = String(form.get('finalAmount') ?? '').trim();
		const dateRaw = String(form.get('finalDate') ?? '').trim();
		const at = dateRaw ? new Date(`${dateRaw}T12:00:00`) : systemClock.now();
		if (Number.isNaN(at.getTime())) return fail(400, { error: 'Invalid date' });
		return run(() =>
			completePurchase(getDb(), deps, scopeOf(locals), params.id, {
				amount: Money.fromDecimal(amountRaw, locals.workspace!.currency),
				at
			})
		);
	},

	edit: async ({ locals, params, request }) => {
		const form = await request.formData();
		const EditSchema = v.object({
			itemName: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
			amount: v.pipe(v.string(), v.trim(), v.minLength(1)),
			categoryId: v.optional(v.string()),
			note: v.optional(v.pipe(v.string(), v.maxLength(2000)))
		});
		const parsed = v.safeParse(EditSchema, Object.fromEntries(form));
		if (!parsed.success) return fail(400, { error: parsed.issues[0].message });
		const f = parsed.output;
		return run(() =>
			editPurchase(getDb(), deps, scopeOf(locals), params.id, {
				itemName: f.itemName,
				requestedAmount: Money.fromDecimal(f.amount, locals.workspace!.currency),
				categoryId: f.categoryId || null,
				note: f.note?.trim() || null
			})
		);
	}
};
