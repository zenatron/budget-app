import { describe, expect, it } from 'vitest';
import { alertLevel, decideBudgetAlert, type BudgetAlertSnapshot } from './alert';

const NOW = new Date('2026-07-24T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

function decide(
	overrides: Partial<Parameters<typeof decideBudgetAlert>[0]> & {
		last?: BudgetAlertSnapshot | null;
	}
) {
	return decideBudgetAlert({
		budgetMinor: 100_000n, // $1,000.00
		actualMinor: 85_000n,
		alertPct: 80,
		cooldownHours: 24,
		now: NOW,
		last: null,
		...overrides
	});
}

describe('alertLevel', () => {
	it('is null under the warning threshold', () => {
		expect(alertLevel(100_000n, 80_000n, 80)).toBeNull();
		expect(alertLevel(100_000n, 50_000n, 80)).toBeNull();
	});

	it('is nearing strictly above the threshold', () => {
		expect(alertLevel(100_000n, 80_001n, 80)).toBe('nearing');
	});

	it('is exceeded strictly above the budget', () => {
		expect(alertLevel(100_000n, 100_000n, 80)).toBe('nearing');
		expect(alertLevel(100_000n, 100_001n, 80)).toBe('exceeded');
	});

	it('never fires on a zero budget', () => {
		expect(alertLevel(0n, 1n, 80)).toBeNull();
	});
});

describe('decideBudgetAlert', () => {
	it('stays quiet under the threshold', () => {
		expect(decide({ actualMinor: 10_000n })).toEqual({ fire: false, level: null, reason: null });
	});

	it('fires the first time the threshold is crossed', () => {
		expect(decide({})).toEqual({ fire: true, level: 'nearing', reason: 'first alert' });
	});

	it('fires the first time the budget is exceeded', () => {
		expect(decide({ actualMinor: 120_000n })).toEqual({
			fire: true,
			level: 'exceeded',
			reason: 'first alert'
		});
	});

	it('does not repeat the same alert inside the cooldown', () => {
		const d = decide({
			actualMinor: 90_000n,
			last: { level: 'nearing', actualMinor: 85_000n, alertedAt: hoursAgo(2) }
		});
		expect(d.fire).toBe(false);
	});

	it('does not re-alert after the cooldown without meaningful new spend', () => {
		const d = decide({
			actualMinor: 86_000n,
			last: { level: 'nearing', actualMinor: 85_000n, alertedAt: hoursAgo(48) }
		});
		expect(d.fire).toBe(false);
	});

	it('re-alerts after the cooldown once spend grew by 5% of the budget', () => {
		const d = decide({
			actualMinor: 90_000n,
			last: { level: 'nearing', actualMinor: 85_000n, alertedAt: hoursAgo(48) }
		});
		expect(d).toEqual({ fire: true, level: 'nearing', reason: 'spend grew' });
	});

	it('escalates to exceeded immediately, ignoring the cooldown', () => {
		const d = decide({
			actualMinor: 101_000n,
			last: { level: 'nearing', actualMinor: 95_000n, alertedAt: hoursAgo(1) }
		});
		expect(d).toEqual({ fire: true, level: 'exceeded', reason: 'threshold crossed' });
	});

	it('never notifies on de-escalation, but reports the new level', () => {
		const d = decide({
			actualMinor: 90_000n,
			last: { level: 'exceeded', actualMinor: 110_000n, alertedAt: hoursAgo(1) }
		});
		expect(d).toEqual({ fire: false, level: 'nearing', reason: null });
	});

	it('after a recorded de-escalation, re-crossing 100% is escalation again', () => {
		const d = decide({
			actualMinor: 105_000n,
			last: { level: 'nearing', actualMinor: 90_000n, alertedAt: hoursAgo(3) }
		});
		expect(d).toEqual({ fire: true, level: 'exceeded', reason: 'threshold crossed' });
	});

	it('treats growth on tiny budgets as any new spend at all', () => {
		const d = decide({
			budgetMinor: 10n,
			actualMinor: 10n, // exceeded needs > 10, so 10 is nearing at 80%
			last: { level: 'nearing', actualMinor: 9n, alertedAt: hoursAgo(72) }
		});
		expect(d).toEqual({ fire: true, level: 'nearing', reason: 'spend grew' });
	});
});
