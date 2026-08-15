import { eq } from 'drizzle-orm';
import { error, fail, redirect } from '@sveltejs/kit';
import { getEnv } from '$lib/server/env';
import { Money, InvalidMoneyError } from '$lib/domain/money/money';
import { PurchaseStateError } from '$lib/domain/purchase/purchase';
import { isStale, waitingDays } from '$lib/domain/approval/staleness';
import { isSealed } from '$lib/domain/visibility/seal';
import { setPurchaseImage, removePurchaseImage, listImages } from '$lib/application/images';
import { ImageValidationError } from '$lib/infra/images/process';
import { getBlobStore } from '$lib/server/blobs';
import {
	PurchaseNotFoundError,
	approvePurchase,
	cancelPurchase,
	completePurchase,
	deletePurchase,
	denyPurchase,
	editPurchase,
	editPurchaseNote,
	recategorizePurchase,
	refundPurchase,
	setPurchaseMerchant,
	setPurchasePlace,
	unsealPurchase
} from '$lib/application/purchases';
import { fromE3, roundToE3 } from '$lib/domain/location/coords';
import type { PurchasePlace } from '$lib/domain/location/place';
import {
	holdPurchase,
	wakePurchase,
	extendHoldPurchase,
	letGoPurchase
} from '$lib/application/hold';
import { calDateInZone, zonedTimeToUtc } from '$lib/domain/time/zoned';
import { addDays } from '$lib/domain/recurrence/rrule';
import { getDb } from '$lib/server/db';
import { listEvents, loadPurchase, memberNames } from '$lib/server/repo/purchases';
import { listCategories } from '$lib/server/repo/workspaces';
import { bucketBalance, loadBucket } from '$lib/server/repo/buckets';
import { merchant, purchase as purchaseTable } from '$lib/server/db/schema';
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
	// Also depend on the workspace param so a switch always re-runs this load,
	// independent of how finely SvelteKit tracks url/params. See +layout.server.ts.
	void params.workspace;
	const db = getDb();
	const now = systemClock.now();
	const scope = { workspaceId: locals.workspace!.id, viewerId: locals.member!.id };
	const p = await loadPurchase(db, scope, params.id, { now });
	if (!p) error(404, 'Not found');

	const [events, names, categories, images, merchants, createdRows] = await Promise.all([
		listEvents(db, p.id),
		memberNames(db, [p.memberId, ...p.approverMemberIds, ...p.sealedFromMemberIds]),
		listCategories(db, locals.workspace!.id),
		listImages(db, scope, p.id, now),
		// Merchant names for the edit field's autocomplete.
		db
			.select({ name: merchant.name })
			.from(merchant)
			.where(eq(merchant.workspaceId, locals.workspace!.id))
			.orderBy(merchant.name),
		// createdAt for the recency gate on the delete affordance.
		db
			.select({ createdAt: purchaseTable.createdAt })
			.from(purchaseTable)
			.where(eq(purchaseTable.id, p.id))
			.limit(1)
	]);
	const createdRow = createdRows[0];
	const category = categories.find((c) => c.id === p.categoryId) ?? null;

	// A refund owns no photo; borrow the original's. listImages applies the seal
	// predicate to the parent, so an unreadable parent yields nothing rather than
	// leaking through the child.
	const inheritedImages =
		images.length === 0 && p.parentPurchaseId
			? await listImages(db, scope, p.parentPurchaseId, now)
			: [];

	// The bucket this is charged against, if any. Completing the purchase is what
	// actually withdraws from it, so the page needs the balance to say up front
	// whether the bucket can cover what's about to be entered.
	let chargedBucket: { name: string; balanceMinor: bigint; currency: string } | null = null;
	if (p.bucketId) {
		const b = await loadBucket(db, locals.workspace!.id, p.bucketId);
		if (b) {
			chargedBucket = {
				name: b.name,
				balanceMinor: await bucketBalance(db, b.id),
				currency: b.currency
			};
		}
	}

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
			categoryName: category ? `${category.icon} ${category.name}` : null,
			merchantName,
			// Already seal-filtered: loadPurchase applies visibleTo, so a purchase
			// this viewer cannot see has no pin they can see either.
			place: p.place,
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
			sealedFromNames: sealed ? p.sealedFromMemberIds.map((id) => names.get(id) ?? 'Unknown') : [],
			heldUntil: p.heldUntil?.toISOString() ?? null,
			bucket: chargedBucket,
			// The pause has lifted but nobody's decided yet — show the resurface.
			heldReady:
				p.state === 'held' && p.heldUntil !== null && p.heldUntil.getTime() <= now.getTime()
		},
		can: {
			decide: pending && p.approverMemberIds.includes(locals.member!.id),
			complete: p.state === 'approved' && mine,
			cancel: mine && ['draft', 'pending_approval', 'approved'].includes(p.state),
			// Item + amount are substance — editable only before completion.
			edit: mine && ['draft', 'pending_approval', 'approved'].includes(p.state),
			// Photos (receipts) can be attached in any state the requester owns.
			addPhoto: mine && p.state !== 'cancelled',
			unseal: mine && sealed,
			// Category, merchant, and note are annotation — editable in any state
			// that isn't dead. Category pre-completion still routes through the
			// state machine (may send back for re-approval); the rest never do.
			annotate: mine && !['denied', 'cancelled'].includes(p.state),
			refund: mine && p.state === 'completed' && !sealed && p.parentPurchaseId === null,
			// Remove-a-mistake: own recent entries, or anything for the owner. Refunds
			// and purchases with refunds against them are removable too (the server
			// takes the refunds with the parent, or un-refunds the parent).
			delete:
				locals.member!.role === 'owner' ||
				(mine &&
					createdRow !== undefined &&
					locals.workspace!.recentDeleteHours > 0 &&
					now.getTime() - createdRow.createdAt.getTime() <=
						locals.workspace!.recentDeleteHours * 3_600_000),
			// Sleep on it: either the requester or an approver, on a pending request.
			hold: pending && (mine || p.approverMemberIds.includes(locals.member!.id)),
			// While asleep, either side can wake it, extend it, or let it go.
			manageHold: p.state === 'held' && (mine || p.approverMemberIds.includes(locals.member!.id))
		},
		images: images.map((i) => ({
			id: i.id,
			blobId: i.blobId,
			thumbBlobId: i.thumbBlobId,
			width: i.width,
			height: i.height
		})),
		// Shown under a reversal arrow, and not editable here — it belongs to the
		// original purchase, which has its own detail page.
		inheritedImage: inheritedImages[0]?.blobId ?? null,
		isRefund: p.parentPurchaseId !== null,
		parentId: p.parentPurchaseId,
		events: events.map((e) => ({
			toState: e.toState,
			actorName: e.actorName,
			reason: e.reason,
			amountMinor: e.amountMinor,
			at: e.at.toISOString()
		})),
		categories: categories.map((c) => ({ id: c.id, name: c.name, icon: c.icon })),
		merchants: merchants.map((m) => m.name),
		locationEnabled: locals.workspace!.locationEnabled,
		// Same gate as the new-purchase form: the Where editor offers address
		// search and name-lookup for coordinate-less links only when there is
		// something behind the endpoint to answer.
		geocoderEnabled: !!getEnv().GEOCODER_URL
	};
};

function scopeOf(locals: App.Locals) {
	return { workspaceId: locals.workspace!.id, memberId: locals.member!.id };
}

/**
 * Turn a chosen duration into a wake instant. "1 night" (< 1 day) is special:
 * it wakes at 9am the next morning in the workspace's timezone, so "sleep on it"
 * is literally that. Everything else is a plain offset from now.
 */
function untilFromDays(days: number, timezone: string): Date {
	const now = systemClock.now();
	if (days < 1) {
		const tomorrow = addDays(calDateInZone(now, timezone), 1);
		return zonedTimeToUtc(tomorrow, 9, 0, timezone);
	}
	return new Date(now.getTime() + days * 86_400_000);
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

	editNote: async ({ locals, params, request }) => {
		const raw = String((await request.formData()).get('note') ?? '').trim();
		if (raw.length > 2000) return fail(400, { error: 'Note is too long' });
		return run(() => editPurchaseNote(getDb(), deps, scopeOf(locals), params.id, raw || null));
	},

	delete: async ({ locals, params }) => {
		const failed = await run(() => deletePurchase(getDb(), deps, scopeOf(locals), params.id));
		if (failed) return failed;
		// Row is gone — send them back to the ledger rather than a 404 detail page.
		redirect(303, `/w/${params.workspace}/purchases`);
	},

	hold: async ({ locals, params, request }) => {
		const days = Number((await request.formData()).get('days'));
		if (!Number.isFinite(days) || days <= 0) return fail(400, { error: 'Pick how long' });
		const until = untilFromDays(days, locals.workspace!.timezone);
		return run(() => holdPurchase(getDb(), deps, scopeOf(locals), params.id, until));
	},

	extendHold: async ({ locals, params, request }) => {
		const days = Number((await request.formData()).get('days'));
		if (!Number.isFinite(days) || days <= 0) return fail(400, { error: 'Pick how long' });
		const until = untilFromDays(days, locals.workspace!.timezone);
		return run(() => extendHoldPurchase(getDb(), deps, scopeOf(locals), params.id, until));
	},

	wake: async ({ locals, params }) =>
		run(() => wakePurchase(getDb(), deps, scopeOf(locals), params.id)),

	letGo: async ({ locals, params }) =>
		run(() => letGoPurchase(getDb(), deps, scopeOf(locals), params.id)),

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
			await setPurchaseImage(
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

	removeImage: async ({ locals, params }) => {
		try {
			await removePurchaseImage(
				getDb(),
				{ ...deps, blobs: getBlobStore() },
				scopeOf(locals),
				params.id
			);
		} catch (e) {
			if (e instanceof PurchaseNotFoundError) error(404, 'Not found');
			if (e instanceof PurchaseStateError) return fail(400, { error: e.message });
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
		const itemName = String(form.get('itemName') ?? '').trim();
		const amountRaw = String(form.get('amount') ?? '').trim();
		if (!itemName) return fail(400, { error: 'Item needs a name' });
		if (!amountRaw) return fail(400, { error: 'How much?' });
		// Optional fields — only updated if the form carries them, so the
		// masthead edit (item + amount only) leaves category/note/merchant alone.
		const categoryIdRaw = form.get('categoryId');
		const noteRaw = form.get('note');
		const merchantRaw = form.get('merchantName');
		return run(async () => {
			const changes: {
				itemName: string;
				requestedAmount: Money;
				categoryId?: string | null;
				note?: string | null;
			} = {
				itemName,
				requestedAmount: Money.fromDecimal(amountRaw, locals.workspace!.currency)
			};
			if (categoryIdRaw !== null) changes.categoryId = String(categoryIdRaw) || null;
			if (noteRaw !== null) changes.note = String(noteRaw).trim() || null;
			await editPurchase(getDb(), deps, scopeOf(locals), params.id, changes);
			if (merchantRaw !== null) {
				await setPurchaseMerchant(
					getDb(),
					deps,
					scopeOf(locals),
					params.id,
					String(merchantRaw).trim() || null
				);
			}
		});
	},

	// Inline annotation edits — each posts its own tiny form from a Details row.
	merchant: async ({ locals, params, request }) => {
		const merchantName =
			String((await request.formData()).get('merchantName') ?? '').trim() || null;
		return run(() => setPurchaseMerchant(getDb(), deps, scopeOf(locals), params.id, merchantName));
	},

	category: async ({ locals, params, request }) => {
		const categoryId = String((await request.formData()).get('categoryId') ?? '') || null;
		return run(() => recategorizePurchase(getDb(), deps, scopeOf(locals), params.id, categoryId));
	},

	/**
	 * Set or clear the place. Validated exactly as on the create form: the wire
	 * format is integer millidegrees, so a doorstep is not expressible whoever is
	 * posting, and `roundToE3` rejects anything that isn't a point on Earth.
	 * Empty coordinates clear the pin — which stays available even with places
	 * turned off, so switching the feature off never strands a pin nobody can
	 * reach.
	 */
	place: async ({ locals, params, request }) => {
		const f = await request.formData();
		const lat = String(f.get('latE3') ?? '').trim();
		const lng = String(f.get('lngE3') ?? '').trim();

		let place: PurchasePlace | null = null;
		if (lat && lng) {
			if (!/^-?\d{1,6}$/.test(lat) || !/^-?\d{1,6}$/.test(lng)) {
				return fail(400, { error: 'That location is not a place on Earth' });
			}
			try {
				const source = String(f.get('locationSource') ?? '');
				place = {
					...roundToE3(fromE3({ latE3: Number(lat), lngE3: Number(lng) })),
					label: String(f.get('placeLabel') ?? '').trim() || null,
					// 'merchant' is never accepted from a client: an inherited pin is
					// something the server works out, not something a form may assert.
					source: source === 'geocode' || source === 'link' ? source : 'device'
				};
			} catch {
				return fail(400, { error: 'That location is not a place on Earth' });
			}
		}
		return run(() => setPurchasePlace(getDb(), deps, scopeOf(locals), params.id, place));
	}
};
