import { fail } from '@sveltejs/kit';
import * as v from 'valibot';
import { getDb } from '$lib/server/db';
import { Money, InvalidMoneyError } from '$lib/domain/money/money';
import {
	RecurrenceError,
	describeRecurrence,
	formatRRule,
	parseRRule
} from '$lib/domain/recurrence/rrule';
import { zonedTimeToUtc } from '$lib/domain/time/zoned';
import { addIncome, deleteIncome, listIncome } from '$lib/server/repo/income';
import { uuidv7 } from '$lib/infra/id/uuidv7';
import { systemClock } from '$lib/infra/time/system-clock';
import type { Actions, PageServerLoad } from './$types';

const deps = { clock: systemClock, ids: uuidv7 };

export const load: PageServerLoad = async ({ locals }) => {
	const rows = await listIncome(getDb(), locals.workspace!.id);
	return {
		entries: rows.map((r) => ({
			id: r.entry.id,
			source: r.entry.source,
			amountMinor: r.entry.amountMinor,
			currency: r.entry.currency,
			receivedAt: r.entry.receivedAt.toISOString(),
			cadence: r.entry.rrule ? describe(r.entry.rrule) : null,
			memberName: r.memberName,
			mine: r.entry.memberId === locals.member!.id
		}))
	};
};

function describe(rrule: string): string {
	try {
		return describeRecurrence(parseRRule(rrule));
	} catch {
		return rrule;
	}
}

const AddSchema = v.object({
	source: v.pipe(v.string(), v.trim(), v.minLength(1, 'Where from?'), v.maxLength(120)),
	amount: v.pipe(v.string(), v.trim(), v.minLength(1, 'How much?')),
	date: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date')),
	repeat: v.picklist(['once', 'monthly']),
	monthDay: v.optional(v.string()),
	note: v.optional(v.pipe(v.string(), v.maxLength(500)))
});

export const actions: Actions = {
	add: async ({ locals, request }) => {
		const parsed = v.safeParse(AddSchema, Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: parsed.issues[0].message });
		const f = parsed.output;
		const [y, m, d] = f.date.split('-').map(Number);

		let amount: Money;
		let rrule: string | null = null;
		try {
			amount = Money.fromDecimal(f.amount, locals.workspace!.currency);
			if (!amount.isPositive) return fail(400, { error: 'Amount must be positive' });
			if (f.repeat === 'monthly') {
				const day = f.monthDay ? Number(f.monthDay) : Math.min(d, 28);
				rrule = formatRRule({
					start: { y, m, d },
					freq: 'monthly',
					interval: 1,
					byMonthDay: day
				});
			}
		} catch (e) {
			if (e instanceof InvalidMoneyError || e instanceof RecurrenceError) {
				return fail(400, { error: e.message });
			}
			throw e;
		}

		await addIncome(getDb(), deps, {
			workspaceId: locals.workspace!.id,
			memberId: locals.member!.id,
			source: f.source,
			amountMinor: amount.minor,
			currency: amount.currency,
			receivedAt: zonedTimeToUtc({ y, m, d }, 9, 0, locals.workspace!.timezone),
			rrule,
			note: f.note?.trim() || null
		});
		return { ok: true };
	},

	remove: async ({ locals, request }) => {
		const id = String((await request.formData()).get('incomeId') ?? '');
		const removed = await deleteIncome(
			getDb(),
			{ workspaceId: locals.workspace!.id, memberId: locals.member!.id },
			id
		);
		if (!removed) return fail(400, { error: 'Only your own entries can be removed' });
		return { ok: true };
	}
};
