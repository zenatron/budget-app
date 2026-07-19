import { and, eq, gte, isNotNull, isNull, lt } from 'drizzle-orm';
import type { Db } from '$lib/server/db';
import { income, user, workspaceMember } from '$lib/server/db/schema';
import type { Period } from '$lib/domain/analytics/period';
import {
	compareDates,
	nextOccurrence,
	parseRRule,
	addDays,
	type CalDate
} from '$lib/domain/recurrence/rrule';
import { zonedTimeToUtc } from '$lib/domain/time/zoned';
import type { Clock } from '$lib/ports/clock';
import type { IdGenerator } from '$lib/ports/id-generator';

/**
 * Income is workspace-open by design — salary secrecy would need the full
 * sealing treatment and is deliberately out of scope. One-off entries carry a
 * received_at; recurring templates carry an rrule and are expanded on the fly
 * (no materialization state to maintain).
 */

export type IncomeRow = typeof income.$inferSelect;

export async function addIncome(
	db: Db,
	deps: { clock: Clock; ids: IdGenerator },
	cmd: {
		workspaceId: string;
		memberId: string;
		source: string;
		amountMinor: bigint;
		currency: string;
		receivedAt: Date;
		rrule: string | null;
		note: string | null;
	}
): Promise<void> {
	await db.insert(income).values({
		id: deps.ids.newId(),
		workspaceId: cmd.workspaceId,
		memberId: cmd.memberId,
		source: cmd.source,
		amountMinor: cmd.amountMinor,
		currency: cmd.currency,
		receivedAt: cmd.receivedAt,
		rrule: cmd.rrule,
		note: cmd.note
	});
}

export async function deleteIncome(
	db: Db,
	scope: { workspaceId: string; memberId: string },
	incomeId: string
): Promise<boolean> {
	const rows = await db
		.delete(income)
		.where(
			and(
				eq(income.id, incomeId),
				eq(income.workspaceId, scope.workspaceId),
				eq(income.memberId, scope.memberId)
			)
		)
		.returning({ id: income.id });
	return rows.length > 0;
}

export async function updateIncome(
	db: Db,
	scope: { workspaceId: string; memberId: string },
	incomeId: string,
	changes: {
		source?: string;
		amountMinor?: bigint;
		currency?: string;
		receivedAt?: Date;
		rrule?: string | null;
		note?: string | null;
	}
): Promise<boolean> {
	const updates: Record<string, unknown> = {};
	if (changes.source !== undefined) updates.source = changes.source;
	if (changes.amountMinor !== undefined) updates.amountMinor = changes.amountMinor;
	if (changes.currency !== undefined) updates.currency = changes.currency;
	if (changes.receivedAt !== undefined) updates.receivedAt = changes.receivedAt;
	if (changes.rrule !== undefined) updates.rrule = changes.rrule;
	if (changes.note !== undefined) updates.note = changes.note;
	if (Object.keys(updates).length === 0) return false;

	const rows = await db
		.update(income)
		.set(updates)
		.where(
			and(
				eq(income.id, incomeId),
				eq(income.workspaceId, scope.workspaceId),
				eq(income.memberId, scope.memberId)
			)
		)
		.returning({ id: income.id });
	return rows.length > 0;
}

export async function listIncome(db: Db, workspaceId: string) {
	return db
		.select({ entry: income, memberName: user.displayName })
		.from(income)
		.innerJoin(workspaceMember, eq(income.memberId, workspaceMember.id))
		.innerJoin(user, eq(workspaceMember.userId, user.id))
		.where(eq(income.workspaceId, workspaceId))
		.orderBy(income.receivedAt);
}

/**
 * Total income for a period: one-offs received in it, plus each recurring
 * template's occurrences that fall inside it. Future occurrences (after
 * `today`) are excluded — income is only counted as it arrives.
 */
export async function incomeInPeriod(
	db: Db,
	workspaceId: string,
	period: Period,
	timezone: string,
	today: CalDate
): Promise<bigint> {
	const from = zonedTimeToUtc(period.from, 0, 0, timezone);
	const to = zonedTimeToUtc(period.toExclusive, 0, 0, timezone);

	const [oneOffs, recurring] = await Promise.all([
		db
			.select({ amountMinor: income.amountMinor })
			.from(income)
			.where(
				and(
					eq(income.workspaceId, workspaceId),
					isNull(income.rrule),
					gte(income.receivedAt, from),
					lt(income.receivedAt, to)
				)
			),
		db
			.select({ id: income.id, amountMinor: income.amountMinor, rrule: income.rrule })
			.from(income)
			.where(and(eq(income.workspaceId, workspaceId), isNotNull(income.rrule)))
	]);

	let total = oneOffs.reduce((a, r) => a + r.amountMinor, 0n);
	for (const r of recurring) {
		if (!r.rrule) continue;
		try {
			const rec = parseRRule(r.rrule);
			let cursor = addDays(period.from, -1);
			for (let i = 0; i < 400; i++) {
				const occ = nextOccurrence(rec, cursor);
				if (compareDates(occ, period.toExclusive) >= 0) break;
				if (compareDates(occ, today) > 0) break;
				total += r.amountMinor;
				cursor = occ;
			}
		} catch (e) {
			// Malformed rule: skip rather than break the whole page — but say so,
			// otherwise the income total is silently wrong and nothing surfaces it.
			console.log(
				JSON.stringify({
					level: 'warn',
					msg: 'income: malformed rrule skipped',
					incomeSourceId: r.id,
					err: (e as Error).message
				})
			);
		}
	}
	return total;
}
