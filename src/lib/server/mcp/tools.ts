/**
 * MCP tool definitions — the budget's public verbs, exposed to any MCP client
 * (Claude, ChatGPT connectors, editors). Each tool is a thin adapter over the
 * existing `application/*` layer and repos: no new business logic lives here.
 *
 * Everything runs as the token's member, so seals, approval routing and
 * permissions apply exactly as they do in the web app. A tool declares the
 * scope it needs (`read` | `write` | `approve`); the server refuses a call whose
 * token lacks it before the handler runs.
 */
import { Money, InvalidMoneyError } from '$lib/domain/money/money';
import { PurchaseStateError } from '$lib/domain/purchase/purchase';
import { ApprovalRoutingError } from '$lib/domain/approval/evaluate';
import { SealError } from '$lib/domain/visibility/seal';
import { calDateInZone } from '$lib/domain/time/zoned';
import { zonedTimeToUtc } from '$lib/domain/time/zoned';
import {
	monthPeriod,
	previousMonthPeriod,
	weekPeriod,
	previousWeekPeriod,
	type Period
} from '$lib/domain/analytics/period';
import { formatMinor } from '$lib/money-format';
import type { Db } from '$lib/server/db';
import type { Clock } from '$lib/ports/clock';
import type { IdGenerator } from '$lib/ports/id-generator';
import type { Notifier } from '$lib/ports/notifier';
import {
	submitPurchase,
	approvePurchase,
	denyPurchase,
	completePurchase,
	cancelPurchase,
	refundPurchase,
	editPurchase,
	unsealPurchase,
	PurchaseNotFoundError
} from '$lib/application/purchases';
import {
	holdPurchase,
	wakePurchase,
	extendHoldPurchase,
	letGoPurchase
} from '$lib/application/hold';
import { addDays } from '$lib/domain/recurrence/rrule';
import {
	createBucket,
	updateBucket,
	pauseBucket,
	resumeBucket,
	archiveBucket,
	addTransaction,
	loadOwnBucket
} from '$lib/server/repo/buckets';
import { addIncome, listIncome, updateIncome, deleteIncome } from '$lib/server/repo/income';
import { setBudget, schedulableBudgetMonths } from '$lib/server/repo/budgets';
import {
	createRule,
	updateRule,
	pauseRule,
	resumeRule,
	endRule,
	materializeDueRules,
	RecurringRuleError
} from '$lib/application/recurring';
import {
	parseRRule,
	formatRRule,
	describeRecurrence,
	RecurrenceError,
	type Recurrence
} from '$lib/domain/recurrence/rrule';
import { listLedger } from '$lib/server/repo/ledger';
import { listPurchases, loadPurchase, listEvents, memberNames } from '$lib/server/repo/purchases';
import { listCategories, listMembers } from '$lib/server/repo/workspaces';
import { listBuckets } from '$lib/server/repo/buckets';
import { safeToSpend } from '$lib/server/repo/forecast';
import { narrateSafeToSpend } from '$lib/domain/forecast/safe-to-spend';
import {
	periodTotal,
	categoryBreakdown,
	memberBreakdown,
	budgetVsActual,
	monthlyTrend
} from '$lib/server/repo/analytics';
import { recurringRule } from '$lib/server/db/schema';
import { and, eq, ne } from 'drizzle-orm';
import type { ApiScope, AuthedToken } from '$lib/server/repo/api-tokens';

export interface ToolContext {
	db: Db;
	deps: { clock: Clock; ids: IdGenerator; notifier: Notifier };
	authed: AuthedToken;
	now: Date;
}

export interface ToolResult {
	/** Human-readable text, always present so any client can render something. */
	text: string;
	/** Machine-readable payload for clients that use structured tool output. */
	data?: unknown;
	isError?: boolean;
}

export interface McpTool {
	name: string;
	description: string;
	scope: ApiScope;
	inputSchema: Record<string, unknown>;
	handler: (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult>;
}

// ---- small helpers -------------------------------------------------------

function scopeOf(ctx: ToolContext) {
	return { workspaceId: ctx.authed.workspace.id, memberId: ctx.authed.member.id };
}
function viewScope(ctx: ToolContext) {
	return { workspaceId: ctx.authed.workspace.id, viewerId: ctx.authed.member.id };
}
function fmt(minor: bigint, ctx: ToolContext) {
	return formatMinor(minor, ctx.authed.workspace.currency);
}
function str(args: Record<string, unknown>, key: string): string | undefined {
	const v = args[key];
	return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}
function required(args: Record<string, unknown>, key: string): string {
	const v = str(args, key);
	if (v === undefined) throw new PurchaseStateError(`Missing required argument: ${key}`);
	return v;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A "YYYY-MM-DD" argument as a UTC instant at local noon in the workspace zone. */
function parseDateArg(raw: string | undefined, tz: string): Date | undefined {
	if (!raw) return undefined;
	if (!DATE_RE.test(raw)) throw new PurchaseStateError(`Invalid date (use YYYY-MM-DD): ${raw}`);
	const [y, m, d] = raw.split('-').map(Number);
	return zonedTimeToUtc({ y, m, d }, 12, 0, tz);
}
function money(ctx: ToolContext, raw: string): Money {
	return Money.fromDecimal(raw, ctx.authed.workspace.currency);
}
/** A positive number argument, e.g. how many days to sleep on a purchase. */
function posNum(args: Record<string, unknown>, key: string): number {
	const v = Number(args[key]);
	if (!Number.isFinite(v) || v <= 0)
		throw new PurchaseStateError(`${key} must be a positive number`);
	return v;
}
/** Days → wake instant. Under a day wakes at 9am tomorrow in the workspace zone. */
function holdUntil(days: number, ctx: ToolContext): Date {
	const tz = ctx.authed.workspace.timezone;
	if (days < 1) return zonedTimeToUtc(addDays(calDateInZone(ctx.now, tz), 1), 9, 0, tz);
	return new Date(ctx.now.getTime() + days * 86_400_000);
}

const WEEKDAY: Record<string, number> = {
	mon: 1,
	tue: 2,
	wed: 3,
	thu: 4,
	fri: 5,
	sat: 6,
	sun: 7
};

/**
 * Build a Recurrence from the tool's friendly fields (freq/interval/weekdays/
 * day_of_month), mirroring exactly what the web form assembles before calling
 * formatRRule. `base` lets an edit start from the rule's current schedule and
 * override only the parts named, so "change it to weekly" doesn't lose the
 * start date. Throws RecurrenceError on nonsense (surfaced as a tool error).
 */
function buildRecurrence(args: Record<string, unknown>, base?: Recurrence): Recurrence {
	const freq = (str(args, 'freq') ?? base?.freq) as Recurrence['freq'] | undefined;
	if (!freq || !['daily', 'weekly', 'monthly', 'yearly'].includes(freq)) {
		throw new RecurrenceError('freq must be one of daily, weekly, monthly, yearly');
	}
	let start = base?.start;
	const startRaw = str(args, 'start_date');
	if (startRaw) {
		if (!DATE_RE.test(startRaw)) throw new RecurrenceError(`Invalid start_date: ${startRaw}`);
		const [y, m, d] = startRaw.split('-').map(Number);
		start = { y, m, d };
	}
	if (!start) throw new RecurrenceError('start_date is required (YYYY-MM-DD)');

	const interval =
		args.interval !== undefined
			? Math.min(Math.max(Math.trunc(Number(args.interval)), 1), 52)
			: (base?.interval ?? 1);
	if (!Number.isInteger(interval)) throw new RecurrenceError('interval must be a whole number');

	const rec: Recurrence = { start, freq, interval };

	if (freq === 'weekly') {
		const raw = Array.isArray(args.weekdays) ? args.weekdays : undefined;
		const days = raw
			? raw.map((w) => WEEKDAY[String(w).toLowerCase()]).filter((n): n is number => !!n)
			: base?.byDay;
		if (days && days.length > 0) rec.byDay = [...new Set(days)].sort((a, b) => a - b);
	} else if (freq === 'monthly' || freq === 'yearly') {
		const dom =
			args.day_of_month !== undefined ? Math.trunc(Number(args.day_of_month)) : base?.byMonthDay;
		if (dom !== undefined) rec.byMonthDay = dom;
		if (freq === 'yearly') rec.byMonth = base?.byMonth ?? start.m;
	}
	return rec;
}

/**
 * Gift-mode seal from friendly args: hide_from (member ids) + reveal_on (date),
 * both or neither. submitPurchase re-validates against the workspace's max seal
 * window and active members (throwing SealError), so this only shapes the value.
 */
function buildSeal(
	args: Record<string, unknown>,
	tz: string
): { sealedUntil: Date; sealedFromMemberIds: string[] } | undefined {
	const hide = Array.isArray(args.hide_from) ? args.hide_from.map(String).filter(Boolean) : [];
	const reveal = str(args, 'reveal_on');
	if (hide.length === 0 && !reveal) return undefined;
	if (hide.length === 0 || !reveal) {
		throw new PurchaseStateError(
			'Gift mode needs both hide_from (member ids) and reveal_on (date).'
		);
	}
	if (!DATE_RE.test(reveal))
		throw new PurchaseStateError(`reveal_on must be YYYY-MM-DD: ${reveal}`);
	const [y, m, d] = reveal.split('-').map(Number);
	return { sealedUntil: zonedTimeToUtc({ y, m, d }, 23, 59, tz), sealedFromMemberIds: hide };
}

/** Surface a domain error's message as a tool error; rethrow anything unexpected. */
function domainErrText(e: unknown): string {
	const mapped = toToolError(e);
	if (mapped) return mapped;
	// Bucket repo mutations throw plain Error with safe, user-facing copy.
	if (e instanceof Error) return e.message;
	throw e;
}

// ---- tools ---------------------------------------------------------------

export const TOOLS: McpTool[] = [
	{
		name: 'whoami',
		description:
			"Return the current workspace, the member you're acting as, the currency, and the scopes this token grants. Call this first to confirm you're pointed at the right budget.",
		scope: 'read',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		async handler(ctx) {
			const data = {
				workspace: ctx.authed.workspace.name,
				workspace_slug: ctx.authed.workspace.slug,
				acting_as: ctx.authed.user.displayName,
				role: ctx.authed.member.role,
				currency: ctx.authed.workspace.currency,
				timezone: ctx.authed.workspace.timezone,
				scopes: ctx.authed.scopes
			};
			return {
				text: `Acting as ${data.acting_as} (${data.role}) in "${data.workspace}". Currency ${data.currency}. Scopes: ${data.scopes.join(', ') || 'none'}.`,
				data
			};
		}
	},
	{
		name: 'list_categories',
		description:
			'List the spending categories in this workspace, with their ids (for use as category_id when logging or requesting a purchase).',
		scope: 'read',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		async handler(ctx) {
			const cats = await listCategories(ctx.db, ctx.authed.workspace.id);
			const data = cats.map((c) => ({ id: c.id, name: c.name, icon: c.icon }));
			const text = data.length
				? data.map((c) => `- ${c.icon ?? ''} ${c.name} (${c.id})`).join('\n')
				: 'No categories yet.';
			return { text, data };
		}
	},
	{
		name: 'list_members',
		description: 'List the people in this workspace, with their member ids.',
		scope: 'read',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		async handler(ctx) {
			const members = await listMembers(ctx.db, ctx.authed.workspace.id);
			const data = members.map((m) => ({
				id: m.member.id,
				name: m.user.displayName,
				role: m.member.role,
				status: m.member.status
			}));
			return { text: data.map((m) => `- ${m.name} — ${m.role} (${m.id})`).join('\n'), data };
		}
	},
	{
		name: 'search_purchases',
		description:
			'Search the ledger. Returns purchases matching an optional text query and filters, newest first. Amounts are shown in the workspace currency.',
		scope: 'read',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'Text to match against the item name.' },
				category_id: {
					type: 'string',
					description: 'Restrict to a category (see list_categories).'
				},
				member_id: { type: 'string', description: 'Restrict to purchases by one member.' },
				from: { type: 'string', description: 'Earliest date, inclusive, YYYY-MM-DD.' },
				to: { type: 'string', description: 'Latest date, inclusive, YYYY-MM-DD.' },
				limit: { type: 'integer', description: 'Max results (1–50, default 20).' }
			},
			additionalProperties: false
		},
		async handler(ctx, args) {
			const tz = ctx.authed.workspace.timezone;
			const from = parseDateArg(str(args, 'from'), tz);
			// `to` is inclusive to the user, half-open in the query: add a day.
			const toRaw = str(args, 'to');
			const to = toRaw
				? new Date(parseDateArg(toRaw, tz)!.getTime() + 24 * 60 * 60 * 1000)
				: undefined;
			const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
			const { entries, hasMore } = await listLedger(ctx.db, viewScope(ctx), ctx.now, {
				search: str(args, 'query'),
				categoryId: str(args, 'category_id'),
				memberId: str(args, 'member_id'),
				from,
				to,
				limit
			});
			const purchases = entries.filter((e) => e.kind === 'purchase');
			const data = purchases.map((p) => ({
				id: p.id,
				item: p.itemName,
				amount: fmt(p.amountMinor, ctx),
				state: p.state,
				requested_by: p.requesterName,
				category: p.categoryName,
				merchant: p.merchantName,
				date: (p.completedAt ?? p.requestedAt ?? p.createdAt).toISOString().slice(0, 10)
			}));
			const text = data.length
				? data
						.map((p) => `- ${p.date} · ${p.amount} · ${p.item} · ${p.state} (${p.id})`)
						.join('\n') +
					(hasMore ? '\n… more results available (raise limit or narrow the search).' : '')
				: 'No matching purchases.';
			return { text, data };
		}
	},
	{
		name: 'get_purchase',
		description: 'Get the full detail and history of one purchase by id.',
		scope: 'read',
		inputSchema: {
			type: 'object',
			properties: { purchase_id: { type: 'string' } },
			required: ['purchase_id'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const id = required(args, 'purchase_id');
			const p = await loadPurchase(ctx.db, viewScope(ctx), id, { now: ctx.now });
			if (!p) return { text: `No purchase found with id ${id}.`, isError: true };
			const [events, names] = await Promise.all([
				listEvents(ctx.db, p.id),
				memberNames(ctx.db, [p.memberId, ...p.approverMemberIds])
			]);
			const amount = p.finalAmount ?? p.approvedAmount ?? p.requestedAmount;
			const data = {
				id: p.id,
				item: p.itemName,
				state: p.state,
				amount: amount.format(),
				requested_amount: p.requestedAmount.format(),
				approved_amount: p.approvedAmount?.format() ?? null,
				final_amount: p.finalAmount?.format() ?? null,
				requested_by: names.get(p.memberId) ?? 'Unknown',
				approvers: p.approverMemberIds.map((mid) => names.get(mid) ?? 'Unknown'),
				note: p.note,
				completed_at: p.completedAt?.toISOString() ?? null,
				history: events.map((e) => ({
					state: e.toState,
					by: e.actorName,
					reason: e.reason,
					at: e.at.toISOString()
				}))
			};
			return {
				text: `${data.item} — ${data.amount} — ${data.state}. Requested by ${data.requested_by}.${data.approvers.length ? ` Approvers: ${data.approvers.join(', ')}.` : ''}`,
				data
			};
		}
	},
	{
		name: 'list_pending_approvals',
		description:
			'List purchases that are waiting on YOUR approval right now. These are the ones you can approve_purchase or deny_purchase.',
		scope: 'read',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		async handler(ctx) {
			const rows = await listPurchases(ctx.db, viewScope(ctx), ctx.now, { limit: 100 });
			const pending = rows.filter((r) => r.state === 'pending_approval' && r.canDecide);
			const data = pending.map((p) => ({
				id: p.id,
				item: p.itemName,
				amount: fmt(p.amountMinor, ctx),
				requested_by: p.requesterName,
				requested_at: p.requestedAt?.toISOString() ?? null
			}));
			const text = data.length
				? data.map((p) => `- ${p.amount} · ${p.item} · from ${p.requested_by} (${p.id})`).join('\n')
				: 'Nothing is waiting on your approval.';
			return { text, data };
		}
	},
	{
		name: 'spending_summary',
		description:
			'Summarize spending for a period: the total, the breakdown by category, and by member. Period is one of this_month, last_month, this_week, last_week.',
		scope: 'read',
		inputSchema: {
			type: 'object',
			properties: {
				period: {
					type: 'string',
					enum: ['this_month', 'last_month', 'this_week', 'last_week'],
					description: 'Which period to summarize. Defaults to this_month.'
				}
			},
			additionalProperties: false
		},
		async handler(ctx, args) {
			const tz = ctx.authed.workspace.timezone;
			const today = calDateInZone(ctx.now, tz);
			const wsd = ctx.authed.workspace.weekStartDay;
			const period: Period =
				args.period === 'last_month'
					? previousMonthPeriod(today)
					: args.period === 'this_week'
						? weekPeriod(today, wsd)
						: args.period === 'last_week'
							? previousWeekPeriod(today, wsd)
							: monthPeriod(today);
			const scope = { ...viewScope(ctx), timezone: tz };
			const [total, byCat, byMember] = await Promise.all([
				periodTotal(ctx.db, scope, period, ctx.now),
				categoryBreakdown(ctx.db, scope, period, ctx.now),
				memberBreakdown(ctx.db, scope, period, ctx.now)
			]);
			const data = {
				period: (args.period as string) || 'this_month',
				from: `${period.from.y}-${String(period.from.m).padStart(2, '0')}-${String(period.from.d).padStart(2, '0')}`,
				total: fmt(total, ctx),
				by_category: byCat.map((c) => ({ name: c.name, amount: fmt(c.totalMinor, ctx) })),
				by_member: byMember.map((m) => ({ name: m.name, amount: fmt(m.totalMinor, ctx) }))
			};
			const text =
				`Total ${data.period.replace('_', ' ')}: ${data.total}\n` +
				`By category:\n${data.by_category.map((c) => `  - ${c.name}: ${c.amount}`).join('\n') || '  (none)'}\n` +
				`By member:\n${data.by_member.map((m) => `  - ${m.name}: ${m.amount}`).join('\n') || '  (none)'}`;
			return { text, data };
		}
	},
	{
		name: 'safe_to_spend',
		description:
			"Harmony's Safe to Spend for the current month: how much cash is genuinely free after income, everything already spent, money committed to approved purchases, upcoming bills, and planned savings. Also reports where you'd land if all pending requests are approved (after_reserved), and the budget guardrail if one is set. Seal-aware — computed as the token's member sees it. Use this for \"how much can I spend?\" questions.",
		scope: 'read',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		async handler(ctx) {
			const r = await safeToSpend(
				ctx.db,
				{ ...viewScope(ctx), timezone: ctx.authed.workspace.timezone },
				ctx.now
			);
			const read = narrateSafeToSpend(r, (m) => fmt(m, ctx));
			const data = {
				free: fmt(r.freeMinor, ctx),
				status: r.status,
				after_reserved: fmt(r.afterReservedMinor, ctx),
				on_plan: r.onPlanMinor === null ? null : fmt(r.onPlanMinor, ctx),
				summary: read.text,
				breakdown: {
					income: fmt(r.breakdown.incomeMinor, ctx),
					spent: fmt(r.breakdown.cashSpentMinor, ctx),
					committed: fmt(r.breakdown.cashCommittedMinor, ctx),
					upcoming_bills: fmt(r.breakdown.upcomingBillsMinor, ctx),
					planned_savings: fmt(r.breakdown.savingsMinor, ctx),
					reserved_pending: fmt(r.breakdown.reservedMinor, ctx),
					sleeping: fmt(r.breakdown.sleepingMinor, ctx),
					budget_remaining:
						r.breakdown.budgetRemainingMinor === null
							? null
							: fmt(r.breakdown.budgetRemainingMinor, ctx)
				}
			};
			const text =
				`${read.text}\n\n` +
				`Free to spend: ${data.free} (${r.status})\n` +
				`Income ${data.breakdown.income} − spent ${data.breakdown.spent} − committed ${data.breakdown.committed} − bills ${data.breakdown.upcoming_bills} − saved ${data.breakdown.planned_savings}\n` +
				`If all pending approved: ${data.after_reserved}` +
				(data.on_plan ? ` · budget leaves ${data.on_plan}` : '');
			return { text, data };
		}
	},
	{
		name: 'spending_trend',
		description:
			'Total spending per month over the last N months (default 6, max 24), oldest first — for spotting whether spending is rising or falling.',
		scope: 'read',
		inputSchema: {
			type: 'object',
			properties: {
				months: { type: 'integer', description: 'How many months back, 1–24 (default 6).' }
			},
			additionalProperties: false
		},
		async handler(ctx, args) {
			const tz = ctx.authed.workspace.timezone;
			const today = calDateInZone(ctx.now, tz);
			const months = Math.min(Math.max(Math.trunc(Number(args.months) || 6), 1), 24);
			// Window: first day of the month (months-1) back → first day of next month.
			const startMonthIdx = today.y * 12 + (today.m - 1) - (months - 1);
			const from = { y: Math.floor(startMonthIdx / 12), m: (startMonthIdx % 12) + 1, d: 1 };
			const toExclusive =
				today.m === 12 ? { y: today.y + 1, m: 1, d: 1 } : { y: today.y, m: today.m + 1, d: 1 };
			const totals = await monthlyTrend(
				ctx.db,
				{ ...viewScope(ctx), timezone: tz },
				{ from, toExclusive },
				ctx.now
			);
			// Emit every month in the window, including zero months, so the series
			// reads as a continuous trend rather than skipping quiet months.
			const monthNames = [
				'Jan',
				'Feb',
				'Mar',
				'Apr',
				'May',
				'Jun',
				'Jul',
				'Aug',
				'Sep',
				'Oct',
				'Nov',
				'Dec'
			];
			const data: { month: string; label: string; total: string; totalMinor: number }[] = [];
			for (let i = 0; i < months; i++) {
				const idx = startMonthIdx + i;
				const y = Math.floor(idx / 12);
				const m = (idx % 12) + 1;
				const key = `${y}-${String(m).padStart(2, '0')}`;
				const minor = totals.get(key) ?? 0n;
				data.push({
					month: key,
					label: `${monthNames[m - 1]} ${y}`,
					total: fmt(minor, ctx),
					totalMinor: Number(minor)
				});
			}
			const text = data.map((d) => `- ${d.label}: ${d.total}`).join('\n');
			return { text, data };
		}
	},
	{
		name: 'budget_status',
		description:
			'How spending tracks against category budgets for a month: budgeted, actual, and remaining (or over) per category.',
		scope: 'read',
		inputSchema: {
			type: 'object',
			properties: {
				period: {
					type: 'string',
					enum: ['this_month', 'last_month'],
					description: 'Which month. Defaults to this_month.'
				}
			},
			additionalProperties: false
		},
		async handler(ctx, args) {
			const tz = ctx.authed.workspace.timezone;
			const today = calDateInZone(ctx.now, tz);
			const period = args.period === 'last_month' ? previousMonthPeriod(today) : monthPeriod(today);
			const lines = await budgetVsActual(
				ctx.db,
				{ ...viewScope(ctx), timezone: tz },
				period,
				ctx.now
			);
			const data = lines.map((l) => {
				const remaining = l.budgetMinor - l.actualMinor;
				const over = remaining < 0n;
				const pct =
					l.budgetMinor > 0n
						? Math.round((Number(l.actualMinor) / Number(l.budgetMinor)) * 100)
						: 0;
				return {
					category: l.categoryName,
					budget: fmt(l.budgetMinor, ctx),
					spent: fmt(l.actualMinor, ctx),
					remaining: fmt(over ? -remaining : remaining, ctx),
					over,
					percent: pct
				};
			});
			const text = data.length
				? data
						.map(
							(l) =>
								`- ${l.category}: ${l.spent} of ${l.budget} (${l.percent}%) · ${l.over ? `over by ${l.remaining}` : `${l.remaining} left`}`
						)
						.join('\n')
				: 'No category budgets set for this month.';
			return { text, data };
		}
	},
	{
		name: 'set_budget',
		description:
			'Set a monthly budget for a category (or the overall budget). Only workspace owners can. Effective this month by default, or a future month (YYYY-MM, up to 12 months out). Replaces the budget in force from that month; past months are untouched.',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: {
				amount: { type: 'string', description: 'Budget amount, decimal.' },
				category_id: {
					type: 'string',
					description: 'Category to budget (see list_categories). Omit for the overall budget.'
				},
				effective_month: {
					type: 'string',
					description: 'Month it takes effect, YYYY-MM. Defaults to this month.'
				}
			},
			required: ['amount'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			if (ctx.authed.member.role !== 'owner') {
				return { text: 'Only a workspace owner can set budgets.', isError: true };
			}
			const amount = money(ctx, required(args, 'amount'));
			if (!amount.isPositive) return { text: 'Budget must be positive.', isError: true };

			const tz = ctx.authed.workspace.timezone;
			const today = calDateInZone(ctx.now, tz);
			const allowed = schedulableBudgetMonths(today);
			const chosen = str(args, 'effective_month') ?? allowed[0];
			if (!allowed.includes(chosen)) {
				return {
					text: `effective_month must be between ${allowed[0]} and ${allowed.at(-1)} (this month through +12).`,
					isError: true
				};
			}
			await setBudget(ctx.db, ctx.deps.ids, {
				workspaceId: ctx.authed.workspace.id,
				categoryId: str(args, 'category_id') ?? null,
				amountMinor: amount.minor,
				effectiveFrom: `${chosen}-01`
			});
			return {
				text: `Set ${str(args, 'category_id') ? 'category' : 'overall'} budget to ${amount.format()} effective ${chosen}.`,
				data: { amount: amount.format(), effective_month: chosen }
			};
		}
	},
	{
		name: 'list_income',
		description: 'List income entries (paychecks and other money in), most recent first.',
		scope: 'read',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		async handler(ctx) {
			const rows = await listIncome(ctx.db, ctx.authed.workspace.id);
			const data = rows
				.slice()
				.reverse()
				.map((r) => ({
					id: r.entry.id,
					source: r.entry.source,
					amount: fmt(r.entry.amountMinor, ctx),
					received: r.entry.receivedAt.toISOString().slice(0, 10),
					who: r.memberName,
					recurring: r.entry.rrule !== null,
					note: r.entry.note
				}));
			const text = data.length
				? data
						.map(
							(r) =>
								`- ${r.received} · ${r.amount} · ${r.source} (${r.who})${r.recurring ? ' · recurring' : ''}`
						)
						.join('\n')
				: 'No income recorded.';
			return { text, data };
		}
	},
	{
		name: 'list_buckets',
		description: 'List savings/allocation buckets with their current balances.',
		scope: 'read',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		async handler(ctx) {
			const buckets = await listBuckets(ctx.db, ctx.authed.workspace.id);
			const data = buckets.map((b) => ({
				id: b.bucket.id,
				name: b.bucket.name,
				owner: b.memberName,
				balance: fmt(b.balanceMinor, ctx),
				monthly: fmt(b.bucket.monthlyAmountMinor, ctx),
				goal: b.bucket.goalCapMinor === null ? null : fmt(b.bucket.goalCapMinor, ctx),
				status: b.bucket.status
			}));
			const text = data.length
				? data
						.map((b) => `- ${b.name}: ${b.balance}${b.goal ? ` / ${b.goal}` : ''} (${b.id})`)
						.join('\n')
				: 'No buckets yet.';
			return { text, data };
		}
	},
	{
		name: 'list_recurring',
		description:
			'List active and paused recurring payment rules (subscriptions, regular bills), with cadence, next charge date, amount, and id.',
		scope: 'read',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		async handler(ctx) {
			const rows = await ctx.db
				.select()
				.from(recurringRule)
				.where(
					and(
						eq(recurringRule.workspaceId, ctx.authed.workspace.id),
						ne(recurringRule.status, 'ended')
					)
				);
			const data = rows.map((r) => {
				let cadence: string;
				try {
					cadence = describeRecurrence(parseRRule(r.rrule));
				} catch {
					cadence = r.rrule;
				}
				return {
					id: r.id,
					item: r.itemName,
					amount: fmt(r.amountMinor, ctx),
					cadence,
					next: r.nextOccurrenceAt?.toISOString().slice(0, 10) ?? null,
					status: r.status,
					auto_complete: r.autoComplete,
					mine: r.memberId === ctx.authed.member.id
				};
			});
			const text = data.length
				? data
						.map(
							(r) =>
								`- ${r.item} · ${r.amount} · ${r.cadence}${r.next ? ` · next ${r.next}` : ''} · ${r.status}${r.mine ? '' : ' (not yours)'} (${r.id})`
						)
						.join('\n')
				: 'No recurring rules.';
			return { text, data };
		}
	},
	{
		name: 'create_recurring',
		description:
			'Create a recurring payment rule (a subscription or regular bill). Generated charges skip approval by design. Set auto_complete=true for a fixed amount that posts as already spent; false to post each charge awaiting its real amount. Optionally backfill charges from the start date up to today.',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: {
				item: { type: 'string' },
				amount: { type: 'string', description: 'Decimal amount in the workspace currency.' },
				freq: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'yearly'] },
				start_date: { type: 'string', description: 'First occurrence date, YYYY-MM-DD.' },
				interval: {
					type: 'integer',
					description:
						'Every N periods (1–52, default 1). E.g. freq=weekly, interval=2 = fortnightly.'
				},
				weekdays: {
					type: 'array',
					items: { type: 'string', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
					description: 'Weekly only: which weekday(s) it lands on.'
				},
				day_of_month: {
					type: 'integer',
					description:
						'Monthly/yearly only: day 1–31, or -1 for the last day of the month. A day longer than a given month (e.g. 30 in February) lands on that month’s last day.'
				},
				category_id: { type: 'string' },
				auto_complete: {
					type: 'boolean',
					description:
						'true = posts as completed spending; false = posts awaiting the real amount. Default false.'
				},
				backfill: {
					type: 'boolean',
					description: 'Also generate occurrences from start_date up to today. Default false.'
				}
			},
			required: ['item', 'amount', 'freq', 'start_date'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const rec = buildRecurrence(args);
			const { ruleId } = await createRule(ctx.db, ctx.deps, scopeOf(ctx), {
				itemName: required(args, 'item'),
				amount: money(ctx, required(args, 'amount')),
				categoryId: str(args, 'category_id') ?? null,
				rrule: formatRRule(rec),
				autoComplete: args.auto_complete === true,
				backfill: args.backfill === true
			});
			// Mirror the web form: land backfilled charges now rather than waiting for
			// the next sweep, so a follow-up list_recurring / search reflects them.
			if (args.backfill === true) await materializeDueRules(ctx.db, ctx.deps);
			const cadence = describeRecurrence(rec);
			return {
				text: `Created recurring "${required(args, 'item')}" — ${cadence}. Rule id ${ruleId}.`,
				data: { rule_id: ruleId, cadence }
			};
		}
	},
	{
		name: 'update_recurring',
		description:
			'Update a recurring rule. Change item, amount (future charges only), category, or auto_complete. To change the schedule, pass freq plus any of start_date/interval/weekdays/day_of_month — omitted schedule fields keep their current value.',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: {
				rule_id: { type: 'string' },
				item: { type: 'string' },
				amount: { type: 'string' },
				category_id: { type: 'string', description: 'Category id, or "none" to clear it.' },
				auto_complete: { type: 'boolean' },
				freq: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'yearly'] },
				start_date: { type: 'string' },
				interval: { type: 'integer' },
				weekdays: {
					type: 'array',
					items: { type: 'string', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }
				},
				day_of_month: { type: 'integer' }
			},
			required: ['rule_id'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const ruleId = required(args, 'rule_id');
			const cmd: {
				itemName?: string;
				amount?: Money;
				categoryId?: string | null;
				rrule?: string;
				autoComplete?: boolean;
			} = {};
			if (str(args, 'item')) cmd.itemName = str(args, 'item');
			if (str(args, 'amount')) cmd.amount = money(ctx, str(args, 'amount')!);
			if (args.category_id !== undefined) {
				const c = str(args, 'category_id');
				cmd.categoryId = !c || c.toLowerCase() === 'none' ? null : c;
			}
			if (typeof args.auto_complete === 'boolean') cmd.autoComplete = args.auto_complete;

			// A schedule change rebuilds the rule from its current schedule plus the
			// named overrides, so "make it monthly" keeps the existing start date.
			const scheduleTouched = ['freq', 'start_date', 'interval', 'weekdays', 'day_of_month'].some(
				(k) => args[k] !== undefined
			);
			if (scheduleTouched) {
				const [row] = await ctx.db
					.select()
					.from(recurringRule)
					.where(
						and(
							eq(recurringRule.id, ruleId),
							eq(recurringRule.workspaceId, ctx.authed.workspace.id)
						)
					)
					.limit(1);
				if (!row) return { text: `No recurring rule with id ${ruleId}.`, isError: true };
				let base: Recurrence | undefined;
				try {
					base = parseRRule(row.rrule);
				} catch {
					base = undefined;
				}
				cmd.rrule = formatRRule(buildRecurrence(args, base));
			}
			await updateRule(ctx.db, ctx.deps, scopeOf(ctx), ruleId, cmd);
			return { text: `Updated recurring rule ${ruleId}.`, data: { rule_id: ruleId } };
		}
	},
	{
		name: 'pause_recurring',
		description: 'Pause a recurring rule — it stops generating charges until resumed.',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: { rule_id: { type: 'string' } },
			required: ['rule_id'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const id = required(args, 'rule_id');
			await pauseRule(ctx.db, ctx.deps, scopeOf(ctx), id);
			return { text: `Paused recurring rule ${id}.`, data: { rule_id: id, status: 'paused' } };
		}
	},
	{
		name: 'resume_recurring',
		description:
			'Resume a paused recurring rule. Charges missed while paused are skipped; the next one is future-only.',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: { rule_id: { type: 'string' } },
			required: ['rule_id'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const id = required(args, 'rule_id');
			await resumeRule(ctx.db, ctx.deps, scopeOf(ctx), id);
			return { text: `Resumed recurring rule ${id}.`, data: { rule_id: id, status: 'active' } };
		}
	},
	{
		name: 'end_recurring',
		description:
			'End a recurring rule permanently (e.g. a cancelled subscription). Past charges are kept; it stops generating new ones and cannot be resumed.',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: { rule_id: { type: 'string' } },
			required: ['rule_id'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const id = required(args, 'rule_id');
			await endRule(ctx.db, ctx.deps, scopeOf(ctx), id);
			return { text: `Ended recurring rule ${id}.`, data: { rule_id: id, status: 'ended' } };
		}
	},
	{
		name: 'log_purchase',
		description:
			'Record a purchase you have ALREADY made (money already spent). If your policy requires approval above a threshold it will be routed for approval automatically; otherwise it is recorded as completed.',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: {
				item: { type: 'string', description: 'What was bought.' },
				amount: {
					type: 'string',
					description: 'Decimal amount in the workspace currency, e.g. "42.50".'
				},
				category_id: { type: 'string', description: 'Optional category id (see list_categories).' },
				merchant: { type: 'string', description: 'Optional store/merchant name.' },
				note: { type: 'string' },
				bucket_id: {
					type: 'string',
					description: 'Optional bucket to charge against (see list_buckets).'
				},
				spent_at: {
					type: 'string',
					description: 'Optional date the purchase happened, YYYY-MM-DD (defaults to now).'
				},
				hide_from: {
					type: 'array',
					items: { type: 'string' },
					description:
						'Gift mode: member ids (see list_members) this purchase is hidden from — invisible to them everywhere, including totals. Requires reveal_on.'
				},
				reveal_on: {
					type: 'string',
					description: 'Gift mode: date the seal opens, YYYY-MM-DD. Requires hide_from.'
				}
			},
			required: ['item', 'amount'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const tz = ctx.authed.workspace.timezone;
			const { purchaseId } = await submitPurchase(ctx.db, ctx.deps, scopeOf(ctx), {
				itemName: required(args, 'item'),
				amount: money(ctx, required(args, 'amount')),
				categoryId: str(args, 'category_id') ?? null,
				note: str(args, 'note') ?? null,
				intent: 'log',
				spentAt: parseDateArg(str(args, 'spent_at'), tz),
				merchantName: str(args, 'merchant') ?? null,
				bucketId: str(args, 'bucket_id') ?? null,
				seal: buildSeal(args, tz)
			});
			const p = await loadPurchase(ctx.db, viewScope(ctx), purchaseId, { now: ctx.now });
			const state = p?.state ?? 'recorded';
			return {
				text:
					state === 'pending_approval'
						? `Logged "${required(args, 'item')}" — it needs approval and has been sent to your approver(s). Purchase id ${purchaseId}.`
						: `Logged "${required(args, 'item')}" as ${state}. Purchase id ${purchaseId}.`,
				data: { purchase_id: purchaseId, state }
			};
		}
	},
	{
		name: 'request_purchase',
		description:
			'Request approval for a purchase you have NOT yet made. Routes to your approver(s) per policy; if no approval is required it is auto-approved.',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: {
				item: { type: 'string' },
				amount: { type: 'string', description: 'Decimal amount, e.g. "120.00".' },
				category_id: { type: 'string' },
				merchant: { type: 'string' },
				note: { type: 'string' },
				hide_from: {
					type: 'array',
					items: { type: 'string' },
					description: 'Gift mode: member ids to hide this from (requires reveal_on).'
				},
				reveal_on: {
					type: 'string',
					description: 'Gift mode: date the seal opens, YYYY-MM-DD (requires hide_from).'
				}
			},
			required: ['item', 'amount'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const { purchaseId } = await submitPurchase(ctx.db, ctx.deps, scopeOf(ctx), {
				itemName: required(args, 'item'),
				amount: money(ctx, required(args, 'amount')),
				categoryId: str(args, 'category_id') ?? null,
				note: str(args, 'note') ?? null,
				intent: 'request',
				merchantName: str(args, 'merchant') ?? null,
				seal: buildSeal(args, ctx.authed.workspace.timezone)
			});
			const p = await loadPurchase(ctx.db, viewScope(ctx), purchaseId, { now: ctx.now });
			return {
				text:
					p?.state === 'pending_approval'
						? `Requested "${required(args, 'item')}" — awaiting approval. Purchase id ${purchaseId}.`
						: `Requested "${required(args, 'item')}" — approved automatically (no approval required). Purchase id ${purchaseId}.`,
				data: { purchase_id: purchaseId, state: p?.state ?? 'unknown' }
			};
		}
	},
	{
		name: 'approve_purchase',
		description: 'Approve a purchase that is waiting on your approval.',
		scope: 'approve',
		inputSchema: {
			type: 'object',
			properties: { purchase_id: { type: 'string' } },
			required: ['purchase_id'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const id = required(args, 'purchase_id');
			await approvePurchase(ctx.db, ctx.deps, scopeOf(ctx), id);
			return { text: `Approved purchase ${id}.`, data: { purchase_id: id, state: 'approved' } };
		}
	},
	{
		name: 'deny_purchase',
		description: 'Deny a purchase that is waiting on your approval, with an optional reason.',
		scope: 'approve',
		inputSchema: {
			type: 'object',
			properties: {
				purchase_id: { type: 'string' },
				reason: { type: 'string', description: 'Optional reason shown to the requester.' }
			},
			required: ['purchase_id'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const id = required(args, 'purchase_id');
			await denyPurchase(ctx.db, ctx.deps, scopeOf(ctx), id, str(args, 'reason') ?? null);
			return { text: `Denied purchase ${id}.`, data: { purchase_id: id, state: 'denied' } };
		}
	},
	{
		name: 'complete_purchase',
		description:
			'Mark an approved purchase as bought, recording what was actually spent and (optionally) the date. A large overage may trigger re-approval.',
		scope: 'approve',
		inputSchema: {
			type: 'object',
			properties: {
				purchase_id: { type: 'string' },
				final_amount: { type: 'string', description: 'What was actually spent, decimal.' },
				date: { type: 'string', description: 'Optional date bought, YYYY-MM-DD (defaults to now).' }
			},
			required: ['purchase_id', 'final_amount'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const id = required(args, 'purchase_id');
			const tz = ctx.authed.workspace.timezone;
			await completePurchase(ctx.db, ctx.deps, scopeOf(ctx), id, {
				amount: money(ctx, required(args, 'final_amount')),
				at: parseDateArg(str(args, 'date'), tz) ?? ctx.now
			});
			return { text: `Marked purchase ${id} as bought.`, data: { purchase_id: id } };
		}
	},
	{
		name: 'edit_purchase',
		description:
			'Edit a purchase you requested — item, amount, category, or note — while it is draft, pending, or approved. Changing item/amount/category on an approved purchase sends it back for approval.',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: {
				purchase_id: { type: 'string' },
				item: { type: 'string' },
				amount: { type: 'string' },
				category_id: { type: 'string', description: 'Category id, or "none" to clear it.' },
				note: { type: 'string' }
			},
			required: ['purchase_id'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const id = required(args, 'purchase_id');
			const changes: {
				itemName?: string;
				requestedAmount?: Money;
				categoryId?: string | null;
				note?: string | null;
			} = {};
			if (str(args, 'item')) changes.itemName = str(args, 'item');
			if (str(args, 'amount')) changes.requestedAmount = money(ctx, str(args, 'amount')!);
			if (args.category_id !== undefined) {
				const c = str(args, 'category_id');
				changes.categoryId = !c || c.toLowerCase() === 'none' ? null : c;
			}
			if (args.note !== undefined) changes.note = str(args, 'note') ?? null;
			await editPurchase(ctx.db, ctx.deps, scopeOf(ctx), id, changes);
			return { text: `Edited purchase ${id}.`, data: { purchase_id: id } };
		}
	},
	{
		name: 'cancel_purchase',
		description: 'Cancel a purchase you requested (while it is draft, pending, or approved).',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: { purchase_id: { type: 'string' } },
			required: ['purchase_id'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const id = required(args, 'purchase_id');
			await cancelPurchase(ctx.db, ctx.deps, scopeOf(ctx), id);
			return { text: `Cancelled purchase ${id}.`, data: { purchase_id: id, state: 'cancelled' } };
		}
	},
	{
		name: 'refund_purchase',
		description:
			'Record a refund against a completed purchase (partial or full). Once refunds cover the full amount the purchase is marked refunded.',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: {
				purchase_id: { type: 'string' },
				amount: { type: 'string', description: 'Refund amount, decimal.' }
			},
			required: ['purchase_id', 'amount'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const id = required(args, 'purchase_id');
			await refundPurchase(
				ctx.db,
				ctx.deps,
				scopeOf(ctx),
				id,
				money(ctx, required(args, 'amount'))
			);
			return { text: `Recorded a refund on purchase ${id}.`, data: { purchase_id: id } };
		}
	},
	{
		name: 'unseal_purchase',
		description:
			'Reveal a gift-sealed purchase now, before its reveal date. Only the person who sealed it can.',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: { purchase_id: { type: 'string' } },
			required: ['purchase_id'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const id = required(args, 'purchase_id');
			await unsealPurchase(ctx.db, ctx.deps, scopeOf(ctx), id);
			return { text: `Revealed purchase ${id}.`, data: { purchase_id: id } };
		}
	},
	{
		name: 'sleep_on_purchase',
		description:
			'Put a pending (or approved) purchase to sleep for a cooling-off period, then resurface it to decide later. Either the requester or an approver can. Use `days` (0.5 wakes at 9am tomorrow).',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: {
				purchase_id: { type: 'string' },
				days: { type: 'number', description: 'How long to pause, in days. 0.5 = overnight.' }
			},
			required: ['purchase_id', 'days'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const id = required(args, 'purchase_id');
			const until = holdUntil(posNum(args, 'days'), ctx);
			await holdPurchase(ctx.db, ctx.deps, scopeOf(ctx), id, until);
			return {
				text: `Put purchase ${id} to sleep until ${until.toISOString()}.`,
				data: { purchase_id: id, state: 'held', held_until: until.toISOString() }
			};
		}
	},
	{
		name: 'extend_hold',
		description: 'Give a sleeping purchase more time before it resurfaces.',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: {
				purchase_id: { type: 'string' },
				days: { type: 'number', description: 'New pause length from now, in days.' }
			},
			required: ['purchase_id', 'days'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const id = required(args, 'purchase_id');
			const until = holdUntil(posNum(args, 'days'), ctx);
			await extendHoldPurchase(ctx.db, ctx.deps, scopeOf(ctx), id, until);
			return {
				text: `Extended the pause on purchase ${id} until ${until.toISOString()}.`,
				data: { purchase_id: id, state: 'held', held_until: until.toISOString() }
			};
		}
	},
	{
		name: 'wake_purchase',
		description:
			'Wake a sleeping purchase — still want it. It returns to waiting for approval, or to approved if it never needed a decision.',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: { purchase_id: { type: 'string' } },
			required: ['purchase_id'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const id = required(args, 'purchase_id');
			await wakePurchase(ctx.db, ctx.deps, scopeOf(ctx), id);
			return { text: `Woke purchase ${id}.`, data: { purchase_id: id } };
		}
	},
	{
		name: 'let_go_purchase',
		description: 'Let a sleeping purchase go — cancel it. The decided-not-to-buy outcome.',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: { purchase_id: { type: 'string' } },
			required: ['purchase_id'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const id = required(args, 'purchase_id');
			await letGoPurchase(ctx.db, ctx.deps, scopeOf(ctx), id);
			return { text: `Let go of purchase ${id}.`, data: { purchase_id: id, state: 'cancelled' } };
		}
	},
	{
		name: 'create_bucket',
		description:
			'Create a savings/allocation bucket that automatically sets aside a fixed amount each month.',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: {
				name: { type: 'string' },
				monthly_amount: { type: 'string', description: 'Amount set aside each month, decimal.' },
				day_of_month: {
					type: 'integer',
					description: 'Day the monthly amount is added, 1–28 (default 1).'
				},
				goal: { type: 'string', description: 'Optional target/cap, decimal.' }
			},
			required: ['name', 'monthly_amount'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			try {
				const b = await createBucket(ctx.db, ctx.deps, {
					workspaceId: ctx.authed.workspace.id,
					memberId: ctx.authed.member.id,
					name: required(args, 'name'),
					monthlyAmountMinor: money(ctx, required(args, 'monthly_amount')).minor,
					currency: ctx.authed.workspace.currency,
					dayOfMonth: Math.min(Math.max(Math.trunc(Number(args.day_of_month) || 1), 1), 28),
					goalCapMinor: str(args, 'goal') ? money(ctx, str(args, 'goal')!).minor : null
				});
				return {
					text: `Created bucket "${b.name}". Bucket id ${b.id}.`,
					data: { bucket_id: b.id }
				};
			} catch (e) {
				return { text: domainErrText(e), isError: true };
			}
		}
	},
	{
		name: 'update_bucket',
		description: 'Update a bucket you own — name, monthly amount, day of month, or goal.',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: {
				bucket_id: { type: 'string' },
				name: { type: 'string' },
				monthly_amount: { type: 'string' },
				day_of_month: { type: 'integer' },
				goal: { type: 'string', description: 'New target/cap, or "none" to clear it.' }
			},
			required: ['bucket_id'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const id = required(args, 'bucket_id');
			try {
				const changes: {
					name?: string;
					monthlyAmountMinor?: bigint;
					dayOfMonth?: number;
					goalCapMinor?: bigint | null;
				} = {};
				if (str(args, 'name')) changes.name = str(args, 'name');
				if (str(args, 'monthly_amount'))
					changes.monthlyAmountMinor = money(ctx, str(args, 'monthly_amount')!).minor;
				if (args.day_of_month !== undefined)
					changes.dayOfMonth = Math.min(Math.max(Math.trunc(Number(args.day_of_month)), 1), 28);
				if (args.goal !== undefined) {
					const g = str(args, 'goal');
					changes.goalCapMinor = !g || g.toLowerCase() === 'none' ? null : money(ctx, g).minor;
				}
				const b = await updateBucket(ctx.db, scopeOf(ctx), id, changes);
				if (!b) return { text: `No bucket ${id} that you own.`, isError: true };
				return { text: `Updated bucket "${b.name}".`, data: { bucket_id: id } };
			} catch (e) {
				return { text: domainErrText(e), isError: true };
			}
		}
	},
	{
		name: 'move_bucket_money',
		description:
			'Move money into or out of a bucket beyond its automatic monthly amount: deposit adds, withdraw removes.',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: {
				bucket_id: { type: 'string' },
				amount: { type: 'string' },
				direction: { type: 'string', enum: ['deposit', 'withdraw'] },
				note: { type: 'string' }
			},
			required: ['bucket_id', 'amount', 'direction'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const id = required(args, 'bucket_id');
			const dir = required(args, 'direction');
			if (dir !== 'deposit' && dir !== 'withdraw') {
				return { text: 'direction must be "deposit" or "withdraw".', isError: true };
			}
			const b = await loadOwnBucket(ctx.db, scopeOf(ctx), id);
			if (!b) return { text: `No bucket ${id} that you own.`, isError: true };
			try {
				const m = Money.fromDecimal(required(args, 'amount'), b.currency);
				const withdraw = dir === 'withdraw';
				await addTransaction(ctx.db, ctx.deps, {
					bucketId: id,
					amountMinor: withdraw ? -m.minor : m.minor,
					currency: b.currency,
					type: withdraw ? 'withdrawal' : 'adjustment',
					note: str(args, 'note') ?? null
				});
				return {
					text: `${withdraw ? 'Withdrew' : 'Deposited'} ${m.format()} ${withdraw ? 'from' : 'into'} "${b.name}".`,
					data: { bucket_id: id }
				};
			} catch (e) {
				return { text: domainErrText(e), isError: true };
			}
		}
	},
	{
		name: 'pause_bucket',
		description: 'Pause a bucket — it stops setting aside its monthly amount until resumed.',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: { bucket_id: { type: 'string' } },
			required: ['bucket_id'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const id = required(args, 'bucket_id');
			try {
				await pauseBucket(ctx.db, scopeOf(ctx), id);
				return { text: `Paused bucket ${id}.`, data: { bucket_id: id, status: 'paused' } };
			} catch (e) {
				return { text: domainErrText(e), isError: true };
			}
		}
	},
	{
		name: 'resume_bucket',
		description: 'Resume a paused bucket so it sets aside its monthly amount again.',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: { bucket_id: { type: 'string' } },
			required: ['bucket_id'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const id = required(args, 'bucket_id');
			try {
				await resumeBucket(ctx.db, scopeOf(ctx), id);
				return { text: `Resumed bucket ${id}.`, data: { bucket_id: id, status: 'active' } };
			} catch (e) {
				return { text: domainErrText(e), isError: true };
			}
		}
	},
	{
		name: 'archive_bucket',
		description: 'Archive a bucket you no longer use. Its balance and history are kept.',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: { bucket_id: { type: 'string' } },
			required: ['bucket_id'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const id = required(args, 'bucket_id');
			try {
				await archiveBucket(ctx.db, scopeOf(ctx), id);
				return { text: `Archived bucket ${id}.`, data: { bucket_id: id, status: 'archived' } };
			} catch (e) {
				return { text: domainErrText(e), isError: true };
			}
		}
	},
	{
		name: 'add_income',
		description: 'Record income received — a paycheck or other money in.',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: {
				source: { type: 'string', description: 'Where it came from, e.g. "Paycheck".' },
				amount: { type: 'string', description: 'Amount received, decimal.' },
				received_at: {
					type: 'string',
					description: 'Date received, YYYY-MM-DD (defaults to today).'
				},
				note: { type: 'string' }
			},
			required: ['source', 'amount'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const tz = ctx.authed.workspace.timezone;
			const amount = money(ctx, required(args, 'amount'));
			await addIncome(ctx.db, ctx.deps, {
				workspaceId: ctx.authed.workspace.id,
				memberId: ctx.authed.member.id,
				source: required(args, 'source'),
				amountMinor: amount.minor,
				currency: ctx.authed.workspace.currency,
				receivedAt: parseDateArg(str(args, 'received_at'), tz) ?? ctx.now,
				rrule: null,
				note: str(args, 'note') ?? null
			});
			return {
				text: `Recorded ${amount.format()} from ${required(args, 'source')}.`,
				data: { source: required(args, 'source'), amount: amount.format() }
			};
		}
	},
	{
		name: 'update_income',
		description:
			'Update an income entry you recorded — its source, amount, date, or note. Get the id from list_income.',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: {
				income_id: { type: 'string' },
				source: { type: 'string' },
				amount: { type: 'string' },
				received_at: { type: 'string', description: 'Date received, YYYY-MM-DD.' },
				note: { type: 'string' }
			},
			required: ['income_id'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const id = required(args, 'income_id');
			const tz = ctx.authed.workspace.timezone;
			const changes: {
				source?: string;
				amountMinor?: bigint;
				receivedAt?: Date;
				note?: string | null;
			} = {};
			if (str(args, 'source')) changes.source = str(args, 'source');
			if (str(args, 'amount')) changes.amountMinor = money(ctx, str(args, 'amount')!).minor;
			if (str(args, 'received_at')) changes.receivedAt = parseDateArg(str(args, 'received_at'), tz);
			if (args.note !== undefined) changes.note = str(args, 'note') ?? null;
			const ok = await updateIncome(ctx.db, scopeOf(ctx), id, changes);
			if (!ok) {
				return { text: `No income ${id} that you recorded (nothing to change).`, isError: true };
			}
			return { text: `Updated income ${id}.`, data: { income_id: id } };
		}
	},
	{
		name: 'delete_income',
		description: 'Delete an income entry you recorded. Get the id from list_income.',
		scope: 'write',
		inputSchema: {
			type: 'object',
			properties: { income_id: { type: 'string' } },
			required: ['income_id'],
			additionalProperties: false
		},
		async handler(ctx, args) {
			const id = required(args, 'income_id');
			const ok = await deleteIncome(ctx.db, scopeOf(ctx), id);
			if (!ok) return { text: `No income ${id} that you recorded.`, isError: true };
			return { text: `Deleted income ${id}.`, data: { income_id: id } };
		}
	}
];

export const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/**
 * Turn a thrown domain error into a friendly tool error string. Domain errors
 * (bad amount, wrong state, routing/seal problems, not found) are the client's
 * fault to fix and safe to surface; anything else rethrows to a 500.
 */
export function toToolError(e: unknown): string | null {
	if (e instanceof PurchaseNotFoundError) return 'Not found in this workspace.';
	if (
		e instanceof PurchaseStateError ||
		e instanceof InvalidMoneyError ||
		e instanceof ApprovalRoutingError ||
		e instanceof SealError ||
		e instanceof RecurringRuleError ||
		e instanceof RecurrenceError
	) {
		return e.message;
	}
	return null;
}
