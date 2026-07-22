import { fail } from '@sveltejs/kit';
import { and, count, eq, isNotNull } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '$lib/server/db';
import { purchase, recurringRule } from '$lib/server/db/schema';
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
	materializeDueRules,
	createRule,
	endRule,
	pauseRule,
	resumeRule,
	updateRule
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

/**
 * A rule's yearly cost in minor units, so we can total across mixed cadences.
 * Weekly rules fire once per listed weekday, so a Mon+Thu rule counts twice a
 * week. Uses the average year (365.25 days) — a display figure, not an invoice.
 */
function annualMinor(amountMinor: bigint, rec: Recurrence): number {
	const a = Number(amountMinor);
	const iv = rec.interval || 1;
	switch (rec.freq) {
		case 'daily':
			return (a * 365.25) / iv;
		case 'weekly':
			return (a * (rec.byDay?.length || 1) * 365.25) / (7 * iv);
		case 'monthly':
			return (a * 12) / iv;
		case 'yearly':
			return a / iv;
	}
}

export const load: PageServerLoad = async ({ locals, params }) => {
	// Re-run this workspace-scoped load when the workspace in the URL changes;
	// a locals-only load declares no such dependency. See +layout.server.ts.
	void params.workspace;
	const db = getDb();
	const [rules, categories, confirmRow] = await Promise.all([
		db.select().from(recurringRule).where(eq(recurringRule.workspaceId, locals.workspace!.id)),
		listCategories(db, locals.workspace!.id),
		// My recurring charges that landed but still need the real amount recorded —
		// the ledger's "Confirm what you paid" section is where you clear them.
		db
			.select({ count: count() })
			.from(purchase)
			.where(
				and(
					eq(purchase.workspaceId, locals.workspace!.id),
					eq(purchase.memberId, locals.member!.id),
					eq(purchase.state, 'approved'),
					isNotNull(purchase.recurringRuleId)
				)
			)
	]);

	// Household outflow across every active rule, normalized to a common period.
	let annual = 0;
	for (const r of rules) {
		if (r.status !== 'active') continue;
		try {
			annual += annualMinor(r.amountMinor, parseRRule(r.rrule));
		} catch {
			/* malformed rule — leave it out of the total rather than guess */
		}
	}

	const view = rules
		.filter((r) => r.status !== 'ended')
		.map((r) => {
			let parsed: Recurrence | null = null;
			try {
				parsed = parseRRule(r.rrule);
			} catch {
				/* malformed rule — skip pre-population */
			}
			// Every cadence normalized to a per-month figure, so a yearly charge
			// can sit next to a monthly one on the same scale (and show a "/mo"
			// subtitle). Falls back to the raw amount for an unparseable rule.
			const monthlyMinor = parsed
				? BigInt(Math.round(annualMinor(r.amountMinor, parsed) / 12))
				: r.amountMinor;
			return {
				id: r.id,
				itemName: r.itemName,
				amountMinor: r.amountMinor,
				monthlyMinor,
				currency: r.currency,
				cadence: describe(r.rrule),
				nextAt: r.nextOccurrenceAt?.toISOString() ?? null,
				status: r.status,
				autoComplete: r.autoComplete,
				categoryId: r.categoryId,
				mine: r.memberId === locals.member!.id,
				freq: parsed?.freq ?? 'monthly',
				interval: parsed?.interval ?? 1,
				monthDay: parsed?.byMonthDay ?? null,
				byDay: parsed?.byDay ?? [],
				// The rule's real anchor. The edit form used to default this to
				// today, which silently re-anchored the schedule on every save —
				// enough to move a weekly rule onto a different weekday.
				startDate: parsed
					? `${parsed.start.y}-${String(parsed.start.m).padStart(2, '0')}-${String(parsed.start.d).padStart(2, '0')}`
					: null
			};
		});

	// Active before paused; within each, soonest next-occurrence first (a rule
	// with no next date sorts last). The view groups by cadence, but the sort
	// still decides the order *inside* each group.
	view.sort((a, b) => {
		const pausedA = a.status === 'paused' ? 1 : 0;
		const pausedB = b.status === 'paused' ? 1 : 0;
		if (pausedA !== pausedB) return pausedA - pausedB;
		const nextA = a.nextAt ?? '￿';
		const nextB = b.nextAt ?? '￿';
		return nextA < nextB ? -1 : nextA > nextB ? 1 : 0;
	});

	return {
		currency: locals.workspace!.currency,
		monthlyTotalMinor: BigInt(Math.round(annual / 12)),
		yearlyTotalMinor: BigInt(Math.round(annual)),
		needsConfirmingCount: confirmRow[0].count,
		rules: view,
		categories: categories.map((c) => ({ id: c.id, name: c.name, icon: c.icon }))
	};
};

function describe(rrule: string): string {
	try {
		return describeRecurrence(parseRRule(rrule));
	} catch {
		// Graceful fallback: strip DTSTART, convert FREQ to readable text
		const parts: Record<string, string> = {};
		for (const part of rrule.split(';')) {
			const [k, v] = part.split('=');
			if (k && v !== undefined) parts[k.toUpperCase()] = v;
		}
		const freq =
			{ DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', YEARLY: 'Yearly' }[parts.FREQ] ??
			parts.FREQ ??
			'';
		const intv = parts.INTERVAL && parts.INTERVAL !== '1' ? ` (every ${parts.INTERVAL})` : '';
		const byday = parts.BYDAY ? ` on ${parts.BYDAY}` : '';
		const bymonthday = parts.BYMONTHDAY ? ` day ${parts.BYMONTHDAY}` : '';
		return `${freq}${intv}${byday}${bymonthday}` || rrule;
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
		const backfill = form.get('backfill') === 'on';
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
					autoComplete: form.get('autoComplete') === 'on',
					backfill
				}
			);

			// Backfill has to land now. The sweep would get to it within five
			// minutes, but the user just asked for past charges and would be looking
			// at a list that doesn't have them yet. Materializing is transactional
			// and takes a row lock, so racing the sweep is safe.
			if (backfill) await materializeDueRules(getDb(), deps);
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

	edit: async ({ locals, request }) => {
		const form = await request.formData();
		const ruleId = String(form.get('ruleId') ?? '');
		const weekDays = form.getAll('weekDay').map(Number);
		const raw = Object.fromEntries(form);

		const itemName = String(raw.itemName ?? '').trim();
		const amountRaw = String(raw.amount ?? '').trim();
		const categoryId = raw.categoryId as string | undefined;
		const freq = raw.freq as string | undefined;
		const intervalRaw = raw.interval as string | undefined;
		const startDate = raw.startDate as string | undefined;
		const autoComplete = form.get('autoComplete') === 'on';

		if (!itemName) return fail(400, { error: 'What is it?' });
		if (!amountRaw) return fail(400, { error: 'How much?' });

		try {
			const updates: {
				itemName?: string;
				amount?: Money;
				categoryId?: string | null;
				rrule?: string;
				autoComplete?: boolean;
			} = {};

			if (itemName) updates.itemName = itemName;
			updates.amount = Money.fromDecimal(amountRaw, locals.workspace!.currency);
			if (categoryId !== undefined) updates.categoryId = categoryId || null;
			updates.autoComplete = autoComplete;

			if (freq && startDate) {
				const [y, m, d] = startDate.split('-').map(Number);
				const interval = Math.max(1, Math.min(52, parseInt(intervalRaw ?? '1') || 1));
				const rec: Recurrence = { start: { y, m, d }, freq: freq as Recurrence['freq'], interval };
				if (freq === 'weekly' && weekDays.length > 0) {
					rec.byDay = weekDays.filter((n) => n >= 1 && n <= 7);
				}
				if ((freq === 'monthly' || freq === 'yearly') && raw.monthDay) {
					rec.byMonthDay = Number(raw.monthDay);
					if (freq === 'yearly') rec.byMonth = m;
				}
				updates.rrule = formatRRule(rec);
			}

			await updateRule(
				getDb(),
				deps,
				{ workspaceId: locals.workspace!.id, memberId: locals.member!.id },
				ruleId,
				updates
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
