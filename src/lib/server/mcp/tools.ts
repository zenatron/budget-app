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
	PurchaseNotFoundError
} from '$lib/application/purchases';
import { listLedger } from '$lib/server/repo/ledger';
import { listPurchases, loadPurchase, listEvents, memberNames } from '$lib/server/repo/purchases';
import { listCategories, listMembers } from '$lib/server/repo/workspaces';
import { listBuckets } from '$lib/server/repo/buckets';
import { periodTotal, categoryBreakdown, memberBreakdown } from '$lib/server/repo/analytics';
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
				bucketId: str(args, 'bucket_id') ?? null
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
				note: { type: 'string' }
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
				merchantName: str(args, 'merchant') ?? null
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
		e instanceof SealError
	) {
		return e.message;
	}
	return null;
}
