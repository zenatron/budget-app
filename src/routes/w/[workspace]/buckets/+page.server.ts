import { fail } from '@sveltejs/kit';
import * as v from 'valibot';
import { getDb } from '$lib/server/db';
import { Money, InvalidMoneyError } from '$lib/domain/money/money';
import {
	createBucket,
	listBuckets,
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

export const load: PageServerLoad = async ({ locals }) => {
	const rows = await listBuckets(getDb(), locals.workspace!.id);
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
			mine: r.bucket.memberId === locals.member!.id
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
