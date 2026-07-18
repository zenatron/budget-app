import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '$lib/server/db';
import { recurringRule } from '$lib/server/db/schema';
import { Money, InvalidMoneyError } from '$lib/domain/money/money';
import {
	RecurrenceError,
	describeRecurrence,
	formatRRule,
	parseRRule,
	type Recurrence
} from '$lib/domain/recurrence/rrule';
import {
	RecurringRuleError,
	createRule,
	endRule,
	pauseRule,
	resumeRule,
	updateRuleAmount
} from '$lib/application/recurring';
import { listCategories } from '$lib/server/repo/workspaces';
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

export const load: PageServerLoad = async ({ locals }) => {
	const db = getDb();
	const [rules, categories] = await Promise.all([
		db.select().from(recurringRule).where(eq(recurringRule.workspaceId, locals.workspace!.id)),
		listCategories(db, locals.workspace!.id)
	]);
	return {
		rules: rules
			.filter((r) => r.status !== 'ended')
			.map((r) => ({
				id: r.id,
				itemName: r.itemName,
				amountMinor: r.amountMinor,
				currency: r.currency,
				cadence: describe(r.rrule),
				nextAt: r.nextOccurrenceAt?.toISOString() ?? null,
				status: r.status,
				autoComplete: r.autoComplete,
				mine: r.memberId === locals.member!.id
			})),
		categories: categories.map((c) => ({ id: c.id, name: c.name, icon: c.icon }))
	};
};

function describe(rrule: string): string {
	try {
		return describeRecurrence(parseRRule(rrule));
	} catch {
		return rrule;
	}
}

const CreateSchema = v.object({
	itemName: v.pipe(v.string(), v.trim(), v.minLength(1, 'What is it?'), v.maxLength(120)),
	amount: v.pipe(v.string(), v.trim(), v.minLength(1, 'How much?')),
	categoryId: v.optional(v.string()),
	freq: v.picklist(['daily', 'weekly', 'monthly', 'yearly']),
	interval: v.pipe(
		v.string(),
		v.transform(Number),
		v.integer('Interval must be a whole number'),
		v.minValue(1),
		v.maxValue(52)
	),
	monthDay: v.optional(v.string()),
	startDate: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a start date'))
});

export const actions: Actions = {
	create: async ({ locals, request }) => {
		const form = await request.formData();
		const weekDays = form.getAll('weekDay').map(Number);
		const parsed = v.safeParse(CreateSchema, Object.fromEntries(form));
		if (!parsed.success) return fail(400, { error: parsed.issues[0].message });
		const f = parsed.output;

		const [y, m, d] = f.startDate.split('-').map(Number);
		const rec: Recurrence = { start: { y, m, d }, freq: f.freq, interval: f.interval };
		if (f.freq === 'weekly' && weekDays.length > 0) {
			rec.byDay = weekDays.filter((n) => n >= 1 && n <= 7);
		}
		if ((f.freq === 'monthly' || f.freq === 'yearly') && f.monthDay) {
			rec.byMonthDay = Number(f.monthDay);
			if (f.freq === 'yearly') rec.byMonth = m;
		}

		try {
			await createRule(
				getDb(),
				deps,
				{ workspaceId: locals.workspace!.id, memberId: locals.member!.id },
				{
					itemName: f.itemName,
					amount: Money.fromDecimal(f.amount, locals.workspace!.currency),
					categoryId: f.categoryId || null,
					rrule: formatRRule(rec),
					autoComplete: form.get('autoComplete') === 'on'
				}
			);
		} catch (e) {
			if (
				e instanceof InvalidMoneyError ||
				e instanceof RecurrenceError ||
				e instanceof RecurringRuleError
			) {
				return fail(400, { error: e.message });
			}
			throw e;
		}
		return { ok: true };
	},

	pause: (event) => ruleAction(event, pauseRule),
	resume: (event) => ruleAction(event, resumeRule),
	end: (event) => ruleAction(event, endRule),

	price: async ({ locals, request }) => {
		const form = await request.formData();
		const ruleId = String(form.get('ruleId') ?? '');
		try {
			await updateRuleAmount(
				getDb(),
				deps,
				{ workspaceId: locals.workspace!.id, memberId: locals.member!.id },
				ruleId,
				Money.fromDecimal(String(form.get('amount') ?? ''), locals.workspace!.currency)
			);
		} catch (e) {
			if (e instanceof InvalidMoneyError || e instanceof RecurringRuleError) {
				return fail(400, { error: e.message });
			}
			throw e;
		}
		return { ok: true };
	}
};

type RuleFn = (
	db: ReturnType<typeof getDb>,
	d: typeof deps,
	scope: { workspaceId: string; memberId: string },
	ruleId: string
) => Promise<void>;

async function ruleAction(
	{ locals, request }: { locals: App.Locals; request: Request },
	fn: RuleFn
) {
	const ruleId = String((await request.formData()).get('ruleId') ?? '');
	try {
		await fn(
			getDb(),
			deps,
			{ workspaceId: locals.workspace!.id, memberId: locals.member!.id },
			ruleId
		);
	} catch (e) {
		if (e instanceof RecurringRuleError) return fail(400, { error: e.message });
		throw e;
	}
	return { ok: true };
}
