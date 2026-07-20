import { fail } from '@sveltejs/kit';
import * as v from 'valibot';
import { getDb } from '$lib/server/db';
import { calDateInZone } from '$lib/domain/time/zoned';
import { Money, InvalidMoneyError } from '$lib/domain/money/money';
import {
	createBucket,
	listBuckets,
	bucketsAccruedInMonth,
	loadOwnBucket,
	updateBucket,
	pauseBucket,
	resumeBucket,
	archiveBucket,
	addTransaction
} from '$lib/server/repo/buckets';
import { uuidv7 } from '$lib/infra/id/uuidv7';
import { systemClock } from '$lib/infra/time/system-clock';
import type { Actions, PageServerLoad } from './$types';

const deps = { clock: systemClock, ids: uuidv7 };

export const load: PageServerLoad = async ({ locals, params }) => {
	// Re-run this workspace-scoped load when the workspace in the URL changes;
	// a locals-only load declares no such dependency. See +layout.server.ts.
	void params.workspace;
	const db = getDb();
	const ws = locals.workspace!;
	const rows = await listBuckets(db, ws.id);

	/*
	 * When each bucket next takes its monthly amount. Recurring charges have
	 * always shown "next Jul 28"; buckets showed nothing, so a new one sat at
	 * $0.00 with no hint that anything was going to happen.
	 *
	 * Mirrors the sweep exactly: it accrues once the day of the month has
	 * arrived and this month hasn't been taken yet.
	 */
	const today = calDateInZone(systemClock.now(), ws.timezone);
	const accrued = await bucketsAccruedInMonth(db, ws.id, today.y, today.m);
	const nextAccrual = (b: { id: string; dayOfMonth: number; status: string }) => {
		if (b.status !== 'active') return null;
		const day = Math.min(b.dayOfMonth, 28);
		if (!accrued.has(b.id)) {
			// Due already, or later this month.
			const d = today.d >= day ? today.d : day;
			return { y: today.y, m: today.m, d, due: today.d >= day };
		}
		const m = today.m === 12 ? 1 : today.m + 1;
		const y = today.m === 12 ? today.y + 1 : today.y;
		return { y, m, d: day, due: false };
	};

	return {
		buckets: rows.map((r) => ({
			id: r.bucket.id,
			name: r.bucket.name,
			monthlyAmountMinor: r.bucket.monthlyAmountMinor,
			currency: r.bucket.currency,
			dayOfMonth: r.bucket.dayOfMonth,
			goalCapMinor: r.bucket.goalCapMinor,
			color: r.bucket.color,
			icon: r.bucket.icon,
			status: r.bucket.status,
			balanceMinor: r.balanceMinor,
			memberName: r.memberName,
			mine: r.bucket.memberId === locals.member!.id,
			nextAccrual: nextAccrual({
				id: r.bucket.id,
				dayOfMonth: r.bucket.dayOfMonth,
				status: r.bucket.status
			}),
			everAccrued: r.balanceMinor !== 0n || accrued.has(r.bucket.id)
		}))
	};
};

const CreateSchema = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Bucket needs a name'), v.maxLength(120)),
	amount: v.pipe(v.string(), v.trim(), v.minLength(1, 'Monthly amount is required')),
	dayOfMonth: v.pipe(v.string(), v.trim(), v.minLength(1, 'Accrual day is required')),
	goalCap: v.optional(v.string()),
	color: v.optional(v.string())
});

export const actions: Actions = {
	create: async ({ locals, request }) => {
		const parsed = v.safeParse(CreateSchema, Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.issues[0].message });
		const f = parsed.output;

		try {
			const monthlyAmount = Money.fromDecimal(f.amount, locals.workspace!.currency);
			const dayOfMonth = parseInt(f.dayOfMonth, 10);
			let goalCapMinor: bigint | null = null;
			if (f.goalCap?.trim()) {
				goalCapMinor = Money.fromDecimal(f.goalCap, locals.workspace!.currency).minor;
			}

			await createBucket(getDb(), deps, {
				workspaceId: locals.workspace!.id,
				memberId: locals.member!.id,
				name: f.name,
				monthlyAmountMinor: monthlyAmount.minor,
				currency: monthlyAmount.currency,
				dayOfMonth,
				goalCapMinor,
				color: f.color?.trim() || null,
				icon: null
			});
		} catch (e) {
			if (e instanceof InvalidMoneyError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: true };
	},

	edit: async ({ locals, request }) => {
		const form = await request.formData();
		const bucketId = String(form.get('bucketId') ?? '');
		const name = String(form.get('name') ?? '').trim();
		const amountRaw = String(form.get('amount') ?? '').trim();
		const dayOfMonthRaw = String(form.get('dayOfMonth') ?? '').trim();
		const goalCapRaw = form.get('goalCap') as string | null;
		const colorRaw = form.get('color') as string | null;

		if (!name) return fail(400, { error: 'Bucket needs a name' });
		if (!amountRaw) return fail(400, { error: 'Monthly amount is required' });

		try {
			const monthlyAmount = Money.fromDecimal(amountRaw, locals.workspace!.currency);
			const changes: {
				name?: string;
				monthlyAmountMinor?: bigint;
				dayOfMonth?: number;
				goalCapMinor?: bigint | null;
				color?: string | null;
			} = { name, monthlyAmountMinor: monthlyAmount.minor };

			if (dayOfMonthRaw) {
				changes.dayOfMonth = parseInt(dayOfMonthRaw, 10);
			}

			if (goalCapRaw !== null && goalCapRaw !== undefined) {
				if (goalCapRaw.trim()) {
					changes.goalCapMinor = Money.fromDecimal(goalCapRaw, locals.workspace!.currency).minor;
				} else {
					changes.goalCapMinor = null;
				}
			}
			if (colorRaw !== null && colorRaw !== undefined) {
				changes.color = colorRaw.trim() || null;
			}

			await updateBucket(
				getDb(),
				{ workspaceId: locals.workspace!.id, memberId: locals.member!.id },
				bucketId,
				changes
			);
		} catch (e) {
			if (e instanceof InvalidMoneyError) return fail(400, { error: e.message });
			if (e instanceof Error) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: true };
	},

	pause: async ({ locals, request }) => {
		const bucketId = String((await request.formData()).get('bucketId') ?? '');
		try {
			await pauseBucket(
				getDb(),
				{ workspaceId: locals.workspace!.id, memberId: locals.member!.id },
				bucketId
			);
		} catch (e) {
			if (e instanceof Error) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: true };
	},

	resume: async ({ locals, request }) => {
		const bucketId = String((await request.formData()).get('bucketId') ?? '');
		try {
			await resumeBucket(
				getDb(),
				{ workspaceId: locals.workspace!.id, memberId: locals.member!.id },
				bucketId
			);
		} catch (e) {
			if (e instanceof Error) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: true };
	},

	archive: async ({ locals, request }) => {
		const bucketId = String((await request.formData()).get('bucketId') ?? '');
		try {
			await archiveBucket(
				getDb(),
				{ workspaceId: locals.workspace!.id, memberId: locals.member!.id },
				bucketId
			);
		} catch (e) {
			if (e instanceof Error) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: true };
	},

	adjust: async ({ locals, request }) => {
		const form = await request.formData();
		const bucketId = String(form.get('bucketId') ?? '');
		const amountRaw = String(form.get('amount') ?? '').trim();
		const type = String(form.get('type') ?? 'withdrawal') as 'withdrawal' | 'adjustment';
		const note = form.get('note') as string | null;

		if (!amountRaw) return fail(400, { error: 'Amount is required' });
		if (type !== 'withdrawal' && type !== 'adjustment') {
			return fail(400, { error: 'Type must be withdrawal or adjustment' });
		}

		// Owner-scoped, like every other bucket mutation: a workspace-scoped load
		// would let any member withdraw from someone else's bucket.
		const b = await loadOwnBucket(
			getDb(),
			{ workspaceId: locals.workspace!.id, memberId: locals.member!.id },
			bucketId
		);
		if (!b) return fail(400, { error: 'Bucket not found' });

		try {
			const money = Money.fromDecimal(amountRaw, b.currency);
			const amountMinor = type === 'withdrawal' ? -money.minor : money.minor;

			await addTransaction(getDb(), deps, {
				bucketId,
				amountMinor,
				currency: b.currency,
				type,
				note: note?.trim() || null
			});
		} catch (e) {
			if (e instanceof InvalidMoneyError) return fail(400, { error: e.message });
			throw e;
		}
		return { ok: true };
	}
};
