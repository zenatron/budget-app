/**
 * When does a budget deserve a notification? Pure decision, no I/O — the
 * application layer supplies the numbers and persists whatever this returns.
 *
 * Three alert-worthy moments:
 *  1. First crossing of the warning threshold this month.
 *  2. Escalation from "nearing" to "exceeded" — always new information, so it
 *     ignores the cooldown.
 *  3. Meaningful new spend at the same level, but no more often than the
 *     cooldown allows. "Meaningful" is a share of the budget itself, so small
 *     budgets don't re-alert on coffee money.
 */

export type BudgetAlertLevel = 'nearing' | 'exceeded';

export interface BudgetAlertSnapshot {
	level: BudgetAlertLevel;
	/** Spend reported in the last alert — growth is measured against this. */
	actualMinor: bigint;
	alertedAt: Date;
}

export type BudgetAlertReason = 'first alert' | 'threshold crossed' | 'spend grew';

export interface BudgetAlertDecision {
	fire: boolean;
	/** Current level even when not firing — the caller tracks de-escalation. */
	level: BudgetAlertLevel | null;
	reason: BudgetAlertReason | null;
}

/** Same-level re-alerts need at least this much new spend, as % of budget. */
export const RE_ALERT_GROWTH_PCT = 5n;

export function alertLevel(
	budgetMinor: bigint,
	actualMinor: bigint,
	alertPct: number
): BudgetAlertLevel | null {
	if (budgetMinor <= 0n) return null;
	if (actualMinor > budgetMinor) return 'exceeded';
	if (actualMinor > (budgetMinor * BigInt(alertPct)) / 100n) return 'nearing';
	return null;
}

export function decideBudgetAlert(input: {
	budgetMinor: bigint;
	actualMinor: bigint;
	/** Workspace setting: percentage consumed where the first warning fires. */
	alertPct: number;
	/** Workspace setting: minimum hours between same-level re-alerts. */
	cooldownHours: number;
	now: Date;
	last: BudgetAlertSnapshot | null;
}): BudgetAlertDecision {
	const level = alertLevel(input.budgetMinor, input.actualMinor, input.alertPct);
	if (!level) return { fire: false, level: null, reason: null };

	if (!input.last) return { fire: true, level, reason: 'first alert' };

	// Escalation breaks cooldown; de-escalation (a refund, a raised budget)
	// never notifies — the caller records it silently so a later re-crossing
	// counts as escalation again.
	if (input.last.level !== level) {
		return level === 'exceeded'
			? { fire: true, level, reason: 'threshold crossed' }
			: { fire: false, level, reason: null };
	}

	const cooldownMs = input.cooldownHours * 3_600_000;
	if (input.now.getTime() - input.last.alertedAt.getTime() < cooldownMs) {
		return { fire: false, level, reason: null };
	}

	const growthDelta = (input.budgetMinor * RE_ALERT_GROWTH_PCT) / 100n;
	const grew = input.actualMinor - input.last.actualMinor >= (growthDelta > 0n ? growthDelta : 1n);
	return grew ? { fire: true, level, reason: 'spend grew' } : { fire: false, level, reason: null };
}
