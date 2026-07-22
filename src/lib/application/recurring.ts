import { and, eq, lte } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { recurringRule, user, workspace, workspaceMember } from '$lib/server/db/schema';
import { Money } from '$lib/domain/money/money';
import type { Purchase, TransitionEvent } from '$lib/domain/purchase/purchase';
import { addDays, nextOccurrence, parseRRule } from '$lib/domain/recurrence/rrule';
import { calDateInZone, zonedTimeToUtc } from '$lib/domain/time/zoned';
import { insertPurchase } from '$lib/server/repo/purchases';
import { announcePurchaseChange } from '$lib/application/notify-dispatch';
import type { Clock } from '$lib/ports/clock';
import type { IdGenerator } from '$lib/ports/id-generator';
import type { Notifier } from '$lib/ports/notifier';

/** Recurring charges land at 09:00 workspace-local on their occurrence date. */
const MATERIALIZE_HOUR = 9;
const DAY_MS = 86_400_000;

/** Catch-up guard: at most this many missed occurrences generated per sweep. */
const MAX_CATCHUP = 36;

interface Deps {
	clock: Clock;
	ids: IdGenerator;
	notifier: Notifier;
}

interface Scope {
	workspaceId: string;
	memberId: string;
}

export class RecurringRuleError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RecurringRuleError';
	}
}

export interface CreateRuleCmd {
	itemName: string;
	amount: Money;
	categoryId: string | null;
	rrule: string;
	autoComplete: boolean;
	/** Also generate the occurrences between the start date and today. */
	backfill?: boolean;
}

export async function createRule(
	db: Db,
	deps: Deps,
	scope: Scope,
	cmd: CreateRuleCmd
): Promise<{ ruleId: string }> {
	const now = deps.clock.now();
	const [ws] = await db
		.select()
		.from(workspace)
		.where(eq(workspace.id, scope.workspaceId))
		.limit(1);
	if (!ws) throw new RecurringRuleError('Workspace not found');
	if (cmd.amount.currency !== ws.currency || !cmd.amount.isPositive) {
		throw new RecurringRuleError(`Amount must be positive ${ws.currency}`);
	}
	const rec = parseRRule(cmd.rrule); // throws RecurrenceError on bad input

	// Normally the first occurrence is today at the earliest — nothing in the
	// past. Backfilling instead anchors to the rule's own start date, and the
	// materialization sweep walks forward from there on its next pass (capped at
	// MAX_CATCHUP). Those charges land silently; see materializeDueRules.
	const today = calDateInZone(now, ws.timezone);
	const from = cmd.backfill ? addDays(rec.start, -1) : addDays(today, -1);
	const next = nextOccurrence(rec, from);

	const ruleId = deps.ids.newId();
	await db.insert(recurringRule).values({
		id: ruleId,
		workspaceId: scope.workspaceId,
		memberId: scope.memberId,
		itemName: cmd.itemName,
		categoryId: cmd.categoryId,
		merchantId: null,
		amountMinor: cmd.amount.minor,
		currency: cmd.amount.currency,
		rrule: cmd.rrule,
		nextOccurrenceAt: zonedTimeToUtc(next, MATERIALIZE_HOUR, 0, ws.timezone),
		lastGeneratedAt: null,
		status: 'active',
		autoComplete: cmd.autoComplete,
		endedAt: null
	});
	return { ruleId };
}

async function loadOwnRule(db: Db, scope: Scope, ruleId: string) {
	const rows = await db
		.select()
		.from(recurringRule)
		.where(and(eq(recurringRule.id, ruleId), eq(recurringRule.workspaceId, scope.workspaceId)))
		.limit(1);
	const rule = rows[0];
	if (!rule) throw new RecurringRuleError('Rule not found');
	if (rule.memberId !== scope.memberId) {
		throw new RecurringRuleError('Only the rule owner can change it');
	}
	return rule;
}

export async function pauseRule(db: Db, deps: Deps, scope: Scope, ruleId: string) {
	const rule = await loadOwnRule(db, scope, ruleId);
	if (rule.status !== 'active') throw new RecurringRuleError('Only active rules can pause');
	await db.update(recurringRule).set({ status: 'paused' }).where(eq(recurringRule.id, ruleId));
}

/** Resuming skips anything missed while paused — next occurrence is future-only. */
export async function resumeRule(db: Db, deps: Deps, scope: Scope, ruleId: string) {
	const now = deps.clock.now();
	const rule = await loadOwnRule(db, scope, ruleId);
	if (rule.status !== 'paused') throw new RecurringRuleError('Only paused rules can resume');
	const [ws] = await db
		.select({ timezone: workspace.timezone })
		.from(workspace)
		.where(eq(workspace.id, scope.workspaceId))
		.limit(1);
	const next = nextOccurrence(parseRRule(rule.rrule), calDateInZone(now, ws.timezone));
	await db
		.update(recurringRule)
		.set({
			status: 'active',
			nextOccurrenceAt: zonedTimeToUtc(next, MATERIALIZE_HOUR, 0, ws.timezone)
		})
		.where(eq(recurringRule.id, ruleId));
}

export async function endRule(db: Db, deps: Deps, scope: Scope, ruleId: string) {
	const rule = await loadOwnRule(db, scope, ruleId);
	if (rule.status === 'ended') throw new RecurringRuleError('Rule already ended');
	await db
		.update(recurringRule)
		.set({ status: 'ended', endedAt: deps.clock.now(), nextOccurrenceAt: null })
		.where(eq(recurringRule.id, ruleId));
}

/** Price change: applies to future occurrences only; history stays as charged. */
export async function updateRuleAmount(
	db: Db,
	deps: Deps,
	scope: Scope,
	ruleId: string,
	amount: Money
) {
	const rule = await loadOwnRule(db, scope, ruleId);
	if (amount.currency !== rule.currency || !amount.isPositive) {
		throw new RecurringRuleError(`Amount must be positive ${rule.currency}`);
	}
	if (rule.status === 'ended') throw new RecurringRuleError('Rule already ended');
	await db
		.update(recurringRule)
		.set({ amountMinor: amount.minor })
		.where(eq(recurringRule.id, ruleId));
}

export interface UpdateRuleCmd {
	itemName?: string;
	amount?: Money;
	categoryId?: string | null;
	rrule?: string;
	autoComplete?: boolean;
}

export async function updateRule(
	db: Db,
	deps: Deps,
	scope: Scope,
	ruleId: string,
	cmd: UpdateRuleCmd
) {
	const now = deps.clock.now();
	const rule = await loadOwnRule(db, scope, ruleId);
	if (rule.status === 'ended') throw new RecurringRuleError('Rule already ended');

	const [ws] = await db
		.select({ timezone: workspace.timezone, currency: workspace.currency })
		.from(workspace)
		.where(eq(workspace.id, scope.workspaceId))
		.limit(1);
	if (!ws) throw new RecurringRuleError('Workspace not found');

	const updates: Record<string, unknown> = {};
	if (cmd.itemName !== undefined) updates.itemName = cmd.itemName;
	if (cmd.amount !== undefined) {
		if (cmd.amount.currency !== rule.currency || !cmd.amount.isPositive) {
			throw new RecurringRuleError(`Amount must be positive ${rule.currency}`);
		}
		updates.amountMinor = cmd.amount.minor;
	}
	if (cmd.categoryId !== undefined) updates.categoryId = cmd.categoryId;
	if (cmd.autoComplete !== undefined) updates.autoComplete = cmd.autoComplete;
	if (cmd.rrule !== undefined) {
		const rec = parseRRule(cmd.rrule);
		const today = calDateInZone(now, ws.timezone);
		const next = nextOccurrence(rec, addDays(today, -1));
		updates.rrule = cmd.rrule;
		updates.nextOccurrenceAt = zonedTimeToUtc(next, MATERIALIZE_HOUR, 0, ws.timezone);
	}
	if (Object.keys(updates).length === 0) return;
	await db.update(recurringRule).set(updates).where(eq(recurringRule.id, ruleId));
}

/**
 * Materialization sweep. Each due rule generates its missed occurrences
 * (capped), advancing next_occurrence_at as it goes. Generated purchases skip
 * approval by design: auto_complete rules land COMPLETED, others land APPROVED
 * awaiting the real final amount. Sealing recurring items is not a thing.
 */
export async function materializeDueRules(db: Db, deps: Deps): Promise<number> {
	const now = deps.clock.now();
	const due = await db
		.select({ ruleId: recurringRule.id, tz: workspace.timezone })
		.from(recurringRule)
		.innerJoin(workspace, eq(recurringRule.workspaceId, workspace.id))
		.where(and(eq(recurringRule.status, 'active'), lte(recurringRule.nextOccurrenceAt, now)));

	let generated = 0;
	for (const { ruleId, tz } of due) {
		// One transaction per occurrence, not per catch-up batch: a failure on the
		// 30th missed occurrence must not roll back the 29 already generated and
		// leave next_occurrence_at unadvanced (which would replay them forever).
		for (let i = 0; i < MAX_CATCHUP; i++) {
			const made = await db.transaction(async (tx) => {
				// Re-check under lock; a concurrent sweep may have handled this rule.
				const locked = await tx
					.select()
					.from(recurringRule)
					.where(eq(recurringRule.id, ruleId))
					.for('update')
					.limit(1);
				const r = locked[0];
				if (!r || r.status !== 'active' || !r.nextOccurrenceAt || r.nextOccurrenceAt > now) {
					return null;
				}
				const rec = parseRRule(r.rrule);
				const occurrenceAt = r.nextOccurrenceAt;
				const amount = Money.of(r.amountMinor, r.currency);
				const p: Purchase = {
					id: deps.ids.newId(),
					workspaceId: r.workspaceId,
					memberId: r.memberId,
					state: r.autoComplete ? 'completed' : 'approved',
					itemName: r.itemName,
					note: null,
					categoryId: r.categoryId,
					requestedAmount: amount,
					approvedAmount: amount,
					finalAmount: r.autoComplete ? amount : null,
					sealedUntil: null,
					sealedFromMemberIds: [],
					requestedAt: null,
					decidedAt: occurrenceAt,
					completedAt: r.autoComplete ? occurrenceAt : null,
					lastNudgedAt: null,
					nudgeCount: 0,
					recurringRuleId: r.id,
					parentPurchaseId: null,
					approverMemberIds: [],
					bucketId: null,
					merchantId: null,
					heldUntil: null,
					heldBy: null
				};
				const event: TransitionEvent = {
					fromState: null,
					toState: p.state,
					actorMemberId: null,
					reason: 'recurring',
					amountSnapshot: amount,
					at: occurrenceAt
				};
				await insertPurchase(tx, deps, p, event);

				const next = nextOccurrence(rec, calDateInZone(occurrenceAt, tz));
				await tx
					.update(recurringRule)
					.set({
						lastGeneratedAt: now,
						nextOccurrenceAt: zonedTimeToUtc(next, MATERIALIZE_HOUR, 0, tz)
					})
					.where(eq(recurringRule.id, r.id));
				return { purchase: p, event };
			});

			if (!made) break;

			// Anything dated more than a day ago is history, not news: a backfilled
			// subscription or a catch-up after downtime. Open pages still refresh
			// over SSE; nobody's phone buzzes twelve times.
			const fresh = made.purchase.decidedAt
				? made.purchase.decidedAt.getTime() >= now.getTime() - DAY_MS
				: true;
			await announcePurchaseChange(db, deps.notifier, made.purchase, made.event, {
				push: fresh
			});
			if (fresh) await notifyRuleOwner(db, deps.notifier, made.purchase);
			generated += 1;
		}
	}
	return generated;
}

async function notifyRuleOwner(db: Db, notifier: Notifier, p: Purchase) {
	try {
		const [row] = await db
			.select({ userId: workspaceMember.userId, slug: workspace.slug })
			.from(workspaceMember)
			.innerJoin(workspace, eq(workspaceMember.workspaceId, workspace.id))
			.innerJoin(user, eq(workspaceMember.userId, user.id))
			.where(eq(workspaceMember.id, p.memberId))
			.limit(1);
		if (!row) return;
		await notifier.notify([{ userId: row.userId, memberId: p.memberId }], 'recurring_due', {
			title: p.state === 'completed' ? 'Recurring charge recorded' : 'Recurring charge due',
			body: `${p.itemName} · ${p.requestedAmount.format()}`,
			path: `/w/${row.slug}/purchases/${p.id}`,
			tag: p.id
		});
	} catch (e) {
		console.log(
			JSON.stringify({ level: 'warn', msg: 'notify: recurring failed', err: (e as Error).message })
		);
	}
}
