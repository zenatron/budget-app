import { fail, redirect } from '@sveltejs/kit';
import * as v from 'valibot';
import { Money, InvalidMoneyError } from '$lib/domain/money/money';
import { ApprovalRoutingError } from '$lib/domain/approval/evaluate';
import { PurchaseStateError } from '$lib/domain/purchase/purchase';
import { SealError } from '$lib/domain/visibility/seal';
import { submitPurchase } from '$lib/application/purchases';
import { holdPurchase } from '$lib/application/hold';
import { setPurchaseImage } from '$lib/application/images';
import { addDays } from '$lib/domain/recurrence/rrule';
import { ImageValidationError } from '$lib/infra/images/process';
import { getBlobStore } from '$lib/server/blobs';
import { getDb } from '$lib/server/db';
import { listCategories, listMembers } from '$lib/server/repo/workspaces';
import { listBuckets } from '$lib/server/repo/buckets';
import { calDateInZone, zonedTimeToUtc } from '$lib/domain/time/zoned';
import { uuidv7 } from '$lib/infra/id/uuidv7';
import { systemClock } from '$lib/infra/time/system-clock';
import { getNotifier } from '$lib/server/notify';
import type { Actions, PageServerLoad } from './$types';

/** A chosen duration → wake instant. "1 night" (<1 day) wakes at 9am tomorrow. */
function untilFromDays(days: number, timezone: string): Date {
	const now = systemClock.now();
	if (days < 1) {
		return zonedTimeToUtc(addDays(calDateInZone(now, timezone), 1), 9, 0, timezone);
	}
	return new Date(now.getTime() + days * 86_400_000);
}

export const load: PageServerLoad = async ({ locals, params }) => {
	// Re-run this workspace-scoped load when the workspace in the URL changes;
	// a locals-only load declares no such dependency. See +layout.server.ts.
	void params.workspace;
	const db = getDb();
	const [categories, members, buckets] = await Promise.all([
		listCategories(db, locals.workspace!.id),
		listMembers(db, locals.workspace!.id),
		listBuckets(db, locals.workspace!.id)
	]);
	return {
		categories: categories.map((c) => ({ id: c.id, name: c.name, icon: c.icon })),
		// Members the purchase could be hidden from (everyone active but me).
		sealableMembers: members
			.filter((m) => m.member.status === 'active' && m.member.id !== locals.member!.id)
			.map((m) => ({ id: m.member.id, displayName: m.user.displayName })),
		maxSealDays: locals.workspace!.maxSealDays,
		billImportEnabled: locals.workspace!.billImportEnabled,
		// Whether to offer the optional category suggestion. Off = deterministic form.
		aiEnabled: locals.workspace!.aiMode !== 'off',
		/*
		 * How to read 03/04/2026 when the document doesn't say. Writing the month
		 * first is essentially a US convention, and the timezone is the only locale
		 * signal the workspace stores. It's a lean, not a fact — the parser flags
		 * any date it had to resolve this way so the UI can admit the doubt.
		 */
		dayFirst: !locals.workspace!.timezone.startsWith('America/'),
		buckets: buckets
			.filter((b) => b.bucket.status === 'active')
			.map((b) => ({ id: b.bucket.id, name: b.bucket.name }))
	};
};

const FormSchema = v.object({
	itemName: v.pipe(v.string(), v.trim(), v.minLength(1, 'What is it?'), v.maxLength(120)),
	amount: v.pipe(v.string(), v.trim(), v.minLength(1, 'How much?')),
	categoryId: v.optional(v.string()),
	note: v.optional(v.pipe(v.string(), v.maxLength(2000))),
	intent: v.picklist(['request', 'log']),
	sealUntil: v.optional(v.string()),
	spentAt: v.optional(v.string())
});

export const actions: Actions = {
	default: async ({ locals, request }) => {
		const form = await request.formData();
		const sealMemberIds = form.getAll('sealMemberIds').map(String);
		const parsed = v.safeParse(FormSchema, {
			...Object.fromEntries(form),
			sealMemberIds: undefined
		});
		if (!parsed.success) return fail(400, { error: parsed.issues[0].message });
		const f = parsed.output;

		let seal;
		if (sealMemberIds.length > 0) {
			if (!f.sealUntil) return fail(400, { error: 'Pick when the seal opens' });
			const until = new Date(`${f.sealUntil}T23:59:59`);
			if (Number.isNaN(until.getTime())) return fail(400, { error: 'Invalid seal date' });
			seal = { sealedUntil: until, sealedFromMemberIds: sealMemberIds };
		} else if (f.sealUntil) {
			return fail(400, { error: 'Pick who the purchase is hidden from' });
		}

		/*
		 * Back-date a logged purchase. Only for the log path — a request hasn't
		 * happened, so a date on it is meaningless and ignored. "Today" is left as
		 * undefined so the app stamps the precise `now`; only a genuinely earlier
		 * date sets completedAt, which is what analytics buckets on. Noon in the
		 * workspace's zone keeps the instant on the intended calendar day either
		 * side of a DST change.
		 */
		let spentAt: Date | undefined;
		if (f.intent === 'log' && f.spentAt) {
			const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f.spentAt);
			if (!m) return fail(400, { error: 'Invalid purchase date' });
			const picked = { y: +m[1], m: +m[2], d: +m[3] };
			const today = calDateInZone(systemClock.now(), locals.workspace!.timezone);
			const toNum = (d: { y: number; m: number; d: number }) => d.y * 10000 + d.m * 100 + d.d;
			if (toNum(picked) > toNum(today)) {
				return fail(400, { error: "You can't log a purchase in the future" });
			}
			if (toNum(picked) < toNum(today)) {
				spentAt = zonedTimeToUtc(picked, 12, 0, locals.workspace!.timezone);
			}
		}

		let purchaseId: string;
		try {
			const amount = Money.fromDecimal(f.amount, locals.workspace!.currency);
			({ purchaseId } = await submitPurchase(
				getDb(),
				{ clock: systemClock, ids: uuidv7, notifier: getNotifier() },
				{ workspaceId: locals.workspace!.id, memberId: locals.member!.id },
				{
					itemName: f.itemName,
					amount,
					categoryId: f.categoryId || null,
					note: f.note?.trim() || null,
					intent: f.intent,
					spentAt,
					seal,
					merchantName: form.get('merchantName')?.toString()?.trim() || null,
					bucketId: form.get('bucketId')?.toString()?.trim() || null
				}
			));
		} catch (e) {
			if (
				e instanceof InvalidMoneyError ||
				e instanceof PurchaseStateError ||
				e instanceof ApprovalRoutingError ||
				e instanceof SealError
			) {
				return fail(400, { error: e.message });
			}
			throw e;
		}

		// "Sleep on it" at creation: submit as a normal request above, then put it
		// straight to sleep. Waking restores it to whatever it resolved to (pending
		// for approval, or approved if it was exempt) — see wake() in the domain.
		const sleepDays = Number(form.get('sleepDays'));
		if (Number.isFinite(sleepDays) && sleepDays > 0) {
			try {
				await holdPurchase(
					getDb(),
					{ clock: systemClock, ids: uuidv7, notifier: getNotifier() },
					{ workspaceId: locals.workspace!.id, memberId: locals.member!.id },
					purchaseId,
					untilFromDays(sleepDays, locals.workspace!.timezone)
				);
			} catch (e) {
				if (!(e instanceof PurchaseStateError)) throw e;
			}
		}

		// Optional photo attached at creation. The purchase already exists, so a
		// bad image is not fatal — skip it (the detail page can add one later).
		const photo = form.get('photo');
		if (photo instanceof File && photo.size > 0) {
			try {
				await setPurchaseImage(
					getDb(),
					{ clock: systemClock, ids: uuidv7, blobs: getBlobStore() },
					{ workspaceId: locals.workspace!.id, memberId: locals.member!.id },
					purchaseId,
					new Uint8Array(await photo.arrayBuffer())
				);
			} catch (e) {
				if (!(e instanceof ImageValidationError) && !(e instanceof PurchaseStateError)) throw e;
			}
		}

		redirect(303, `/w/${locals.workspace!.slug}/purchases/${purchaseId}`);
	}
};
