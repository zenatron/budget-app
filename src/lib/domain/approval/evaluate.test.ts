import { describe, expect, it } from 'vitest';
import { Money } from '../money/money';
import { ApprovalRoutingError, approvalRequired, resolveApprovers } from './evaluate';
import type { ApprovalPolicy } from './policy';
import { isStale, nextNudgeAt, waitingDays, MAX_NUDGES } from './staleness';

const usd = (n: number) => Money.of(n, 'USD');

const policy = (over: Partial<ApprovalPolicy> = {}): ApprovalPolicy => ({
	mode: 'none',
	routing: { mode: 'any_of', approver_ids: ['a1'] },
	...over
});

describe('approvalRequired', () => {
	it('mode none / always', () => {
		expect(approvalRequired(policy({ mode: 'none' }), usd(1_000_000), null)).toBe(false);
		expect(approvalRequired(policy({ mode: 'always' }), usd(1), null)).toBe(true);
	});

	it('threshold: required at and above, not below', () => {
		const p = policy({ mode: 'threshold', threshold_minor: 5000 });
		expect(approvalRequired(p, usd(4999), null)).toBe(false);
		expect(approvalRequired(p, usd(5000), null)).toBe(true);
		expect(approvalRequired(p, usd(5001), null)).toBe(true);
	});

	it('broken threshold fails safe (requires approval)', () => {
		expect(approvalRequired(policy({ mode: 'threshold' }), usd(1), null)).toBe(true);
	});

	it('category overrides beat the base mode', () => {
		const p = policy({
			mode: 'threshold',
			threshold_minor: 5000,
			category_overrides: { groceries: 'exempt', electronics: 'always' }
		});
		expect(approvalRequired(p, usd(99999), 'groceries')).toBe(false);
		expect(approvalRequired(p, usd(1), 'electronics')).toBe(true);
		expect(approvalRequired(p, usd(1), 'other')).toBe(false);
		const alwaysButExempt = policy({ mode: 'always', category_overrides: { g: 'exempt' } });
		expect(approvalRequired(alwaysButExempt, usd(1), 'g')).toBe(false);
	});
});

describe('resolveApprovers', () => {
	it('any_of keeps all active approvers', () => {
		const p = policy({ routing: { mode: 'any_of', approver_ids: ['a1', 'a2', 'gone'] } });
		expect(resolveApprovers(p, ['a1', 'a2', 'other'])).toEqual(['a1', 'a2']);
	});

	it('any_of with no active approvers throws', () => {
		const p = policy({ routing: { mode: 'any_of', approver_ids: ['gone'] } });
		expect(() => resolveApprovers(p, ['a1'])).toThrow(ApprovalRoutingError);
		const empty = policy({ routing: { mode: 'any_of', approver_ids: [] } });
		expect(() => resolveApprovers(empty, ['a1'])).toThrow(ApprovalRoutingError);
	});

	it('specific requires exactly one, active', () => {
		const p = policy({ routing: { mode: 'specific', approver_ids: ['a1'] } });
		expect(resolveApprovers(p, ['a1', 'a2'])).toEqual(['a1']);
		expect(() =>
			resolveApprovers(policy({ routing: { mode: 'specific', approver_ids: ['a1', 'a2'] } }), [
				'a1',
				'a2'
			])
		).toThrow(ApprovalRoutingError);
		expect(() => resolveApprovers(p, ['a2'])).toThrow(ApprovalRoutingError);
	});

	it('self-approval is not special: requester may be the approver', () => {
		const p = policy({ routing: { mode: 'any_of', approver_ids: ['me'] } });
		expect(resolveApprovers(p, ['me'])).toEqual(['me']);
	});
});

describe('staleness', () => {
	const requestedAt = new Date('2026-07-01T00:00:00Z');

	it('is derived from the clock, boundary exclusive', () => {
		expect(isStale(requestedAt, 48, new Date('2026-07-03T00:00:00Z'))).toBe(false); // exactly 48h
		expect(isStale(requestedAt, 48, new Date('2026-07-03T00:00:01Z'))).toBe(true);
		expect(isStale(requestedAt, 48, new Date('2026-07-01T01:00:00Z'))).toBe(false);
	});

	it('first nudge is due at the staleness threshold', () => {
		expect(nextNudgeAt(requestedAt, 48, null, 0)).toEqual(new Date('2026-07-03T00:00:00Z'));
	});

	it('subsequent nudges are daily after the last one', () => {
		const last = new Date('2026-07-03T00:00:00Z');
		expect(nextNudgeAt(requestedAt, 48, last, 1)).toEqual(new Date('2026-07-04T00:00:00Z'));
	});

	it('caps at MAX_NUDGES then goes silent', () => {
		expect(nextNudgeAt(requestedAt, 48, new Date(), MAX_NUDGES)).toBeNull();
	});

	it('reports whole waiting days', () => {
		expect(waitingDays(requestedAt, new Date('2026-07-04T12:00:00Z'))).toBe(3);
		expect(waitingDays(requestedAt, requestedAt)).toBe(0);
	});
});
