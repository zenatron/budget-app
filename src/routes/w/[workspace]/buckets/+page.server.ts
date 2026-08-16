import { fail } from '@sveltejs/kit';
import * as v from 'valibot';
import { getDb } from '$lib/server/db';
import { calDateInZone } from '$lib/domain/time/zoned';
import { Money, InvalidMoneyError } from '$lib/domain/money/money';
import {
	RecurrenceError,
	describeRecurrence,
	formatRRule,
	parseRRule,
	type Recurrence
} from '$lib/domain/recurrence/rrule';
import { firstAccrualAt, materializeBucketAccruals } from '$lib/application/buckets';
import {
	createBucket,
	listBuckets,
	lifetimeSaved,
	loadOwnBucket,
	updateBucket,
	pauseBucket,
	resumeBucket,
	archiveBucket,
	addTransaction
} from '$lib/repo/buckets';
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
	const [rows, lifetimeSavedMinor] = await Promise.all([
		listBuckets(db, ws.id),
		lifetimeSaved(db, ws.id)
	]);

	return {
		currency: ws.currency,
		// What's actually in the visible buckets right now (active + paused;
		// archived already excluded by listBuckets).
		onHandMinor: rows.reduce((sum, r) => sum + r.balanceMinor, 0n),
		// Gross ever set aside across the workspace — matches the Activity page's
		// lifetime "Saved" figure. Bigger than on-hand once anything's been spent.
		lifetimeSavedMinor,
		buckets: rows.map((r) => {
			let parsed: Recurrence | null = null;
			try {
				parsed = parseRRule(r.bucket.rrule);
			} catch {
				/* malformed rule — skip pre-population */
			}
			return {
				id: r.bucket.id,
				name: r.bucket.name,
				amountMinor: r.bucket.amountMinor,
				currency: r.bucket.currency,
				goalCapMinor: r.bucket.goalCapMinor,
				color: r.bucket.color,
				icon: r.bucket.icon,
				status: r.bucket.status,
				balanceMinor: r.balanceMinor,
				memberName: r.memberName,
				mine: r.bucket.memberId === locals.member!.id,
				nextAccrualAt: r.bucket.nextAccrualAt,
				// "next" vs "first" accrual. Asked of the transaction count, not the
				// balance: a bucket that accrued and was then spent flat sits at zero
				// with a history behind it, and calling that one "first" was wrong.
				everAccrued: r.txCount > 0,
				cadence: parsed ? describeRecurrence(parsed) : '',
				freq: parsed?.freq ?? 'monthly',
				interval: parsed?.interval ?? 1,
				byDay: parsed?.byDay ?? [],
				monthDay: parsed?.byMonthDay ?? null,
				// The rule's real anchor. Defaulting the edit form to today would
				// silently re-anchor the schedule on every save — enough to move a
				// weekly rule onto a different weekday.
				startDate: parsed
					? `${parsed.start.y}-${String(parsed.start.m).padStart(2, '0')}-${String(parsed.start.d).padStart(2, '0')}`
					: null
			};
		})
	};
};

/** Form fields → Recurrence, the same shape the recurring page builds. */
function recurrenceFromForm(f: {
	freq: string;
	interval: number;
	monthDay?: string;
	startDate: string;
	weekDays: number[];
}): Recurrence {
	const [y, m, d] = f.startDate.split('-').map(Number);
	const rec: Recurrence = {
		start: { y, m, d },
		freq: f.freq as Recurrence['freq'],
		interval: f.interval
	};
	if (f.freq === 'weekly' && f.weekDays.length > 0) {
		rec.byDay = f.weekDays.filter((n) => n >= 1 && n <= 7);
	}
	if ((f.freq === 'monthly' || f.freq === 'yearly') && f.monthDay) {
		rec.byMonthDay = Number(f.monthDay);
		if (f.freq === 'yearly') rec.byMonth = m;
	}
	return rec;
}

const CreateSchema = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Bucket needs a name'), v.maxLength(120)),
	amount: v.pipe(v.string(), v.trim(), v.minLength(1, 'Amount is required')),
	freq: v.picklist(['daily', 'weekly', 'monthly', 'yearly']),
	interval: v.pipe(
		v.string(),
		v.transform(Number),
		v.integer('Interval must be a whole number'),
		v.minValue(1),
		v.maxValue(52)
	),
	monthDay: v.optional(v.string()),
	startDate: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a start date')),
	goalCap: v.optional(v.string()),
	color: v.optional(v.string())
});

export const actions: Actions = {
	create: async ({ locals, request }) => {
		const form = await request.formData();
		const weekDays = form.getAll('weekDay').map(Number);
		const backfill = form.get('backfill') === 'on';
		const parsed = v.safeParse(CreateSchema, Object.fromEntries(form));
		if (!parsed.success) return fail(400, { error: parsed.issues[0].message });
		const f = parsed.output;

		try {
			const amount = Money.fromDecimal(f.amount, locals.workspace!.currency);
			if (!amount.isPositive) return fail(400, { error: 'Amount must be positive' });
			let goalCapMinor: bigint | null = null;
			if (f.goalCap?.trim()) {
				goalCapMinor = Money.fromDecimal(f.goalCap, locals.workspace!.currency).minor;
			}

			const ws = locals.workspace!;
			const rrule = formatRRule(recurrenceFromForm({ ...f, weekDays }));
			const today = calDateInZone(deps.clock.now(), ws.timezone);

			await createBucket(getDb(), deps, {
				workspaceId: ws.id,
				memberId: locals.member!.id,
				name: f.name,
				amountMinor: amount.minor,
				currency: amount.currency,
				rrule,
				goalCapMinor,
				color: f.color?.trim() || null,
				icon: null,
				nextAccrualAt: firstAccrualAt(rrule, today, ws.timezone, { backfill })
			});

			// Backfill has to land now, not whenever the sweep next runs: the user
			// just asked for past accruals and would be looking at a balance that
			// doesn't have them yet. The sweep takes a row lock, so racing it is safe.
			if (backfill) await materializeBucketAccruals(getDb(), deps);
		} catch (e) {
			if (e instanceof InvalidMoneyError || e instanceof RecurrenceError) {
				return fail(400, { error: e.message });
			}
			throw e;
		}
		return { ok: true };
	},

	edit: async ({ locals, request }) => {
		const form = await request.formData();
		const bucketId = String(form.get('bucketId') ?? '');
		const weekDays = form.getAll('weekDay').map(Number);
		const name = String(form.get('name') ?? '').trim();
		const amountRaw = String(form.get('amount') ?? '').trim();
		const freq = String(form.get('freq') ?? '');
		const intervalRaw = String(form.get('interval') ?? '1');
		const monthDay = form.get('monthDay') as string | null;
		const startDate = String(form.get('startDate') ?? '');
		const goalCapRaw = form.get('goalCap') as string | null;
		const colorRaw = form.get('color') as string | null;

		if (!name) return fail(400, { error: 'Bucket needs a name' });
		if (!amountRaw) return fail(400, { error: 'Amount is required' });

		try {
			const ws = locals.workspace!;
			const amount = Money.fromDecimal(amountRaw, ws.currency);
			if (!amount.isPositive) return fail(400, { error: 'Amount must be positive' });
			const changes: {
				name?: string;
				amountMinor?: bigint;
				rrule?: string;
				nextAccrualAt?: Date | null;
				goalCapMinor?: bigint | null;
				color?: string | null;
			} = { name, amountMinor: amount.minor };

			if (freq && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
				const interval = Math.max(1, Math.min(52, parseInt(intervalRaw) || 1));
				const rrule = formatRRule(
					recurrenceFromForm({
						freq,
						interval,
						monthDay: monthDay ?? undefined,
						startDate,
						weekDays
					})
				);
				changes.rrule = rrule;
				// A cadence change reschedules future-only — what's already accrued
				// stays accrued, the new rule picks up from today.
				const today = calDateInZone(deps.clock.now(), ws.timezone);
				changes.nextAccrualAt = firstAccrualAt(rrule, today, ws.timezone);
			}

			if (goalCapRaw !== null && goalCapRaw !== undefined) {
				if (goalCapRaw.trim()) {
					changes.goalCapMinor = Money.fromDecimal(goalCapRaw, ws.currency).minor;
				} else {
					changes.goalCapMinor = null;
				}
			}
			if (colorRaw !== null && colorRaw !== undefined) {
				changes.color = colorRaw.trim() || null;
			}

			await updateBucket(
				getDb(),
				{ workspaceId: ws.id, memberId: locals.member!.id },
				bucketId,
				changes
			);
		} catch (e) {
			if (e instanceof InvalidMoneyError || e instanceof RecurrenceError) {
				return fail(400, { error: e.message });
			}
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
		const ws = locals.workspace!;
		try {
			const b = await loadOwnBucket(
				getDb(),
				{ workspaceId: ws.id, memberId: locals.member!.id },
				bucketId
			);
			if (!b) return fail(400, { error: 'Bucket not found' });
			const today = calDateInZone(deps.clock.now(), ws.timezone);
			await resumeBucket(
				getDb(),
				{ workspaceId: ws.id, memberId: locals.member!.id },
				bucketId,
				firstAccrualAt(b.rrule, today, ws.timezone)
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
