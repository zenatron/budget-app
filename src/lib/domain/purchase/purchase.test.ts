import { describe, expect, it } from 'vitest';
import { Money } from '../money/money';
import {
	approve,
	autoApprove,
	cancel,
	complete,
	deny,
	edit,
	markRefunded,
	needsReapproval,
	requestApproval,
	PurchaseStateError,
	type Purchase,
	type PurchaseState
} from './purchase';

const NOW = new Date('2026-07-01T12:00:00Z');
const usd = (n: number) => Money.of(n, 'USD');

function draft(overrides: Partial<Purchase> = {}): Purchase {
	return {
		id: 'p1',
		workspaceId: 'w1',
		memberId: 'm-requester',
		state: 'draft',
		itemName: 'Headphones',
		note: null,
		categoryId: 'cat-electronics',
		requestedAmount: usd(18000),
		approvedAmount: null,
		finalAmount: null,
		sealedUntil: null,
		sealedFromMemberIds: [],
		requestedAt: null,
		decidedAt: null,
		completedAt: null,
		clearedAt: null,
		lastNudgedAt: null,
		nudgeCount: 0,
		recurringRuleId: null,
		parentPurchaseId: null,
		approverMemberIds: [],
		bucketId: null,
		merchantId: null,
		heldUntil: null,
		heldBy: null,
		...overrides
	};
}

const pending = (o: Partial<Purchase> = {}) =>
	draft({ state: 'pending_approval', approverMemberIds: ['m-approver'], requestedAt: NOW, ...o });
const approved = (o: Partial<Purchase> = {}) =>
	draft({
		state: 'approved',
		approverMemberIds: ['m-approver'],
		approvedAmount: usd(18000),
		decidedAt: NOW,
		...o
	});
const completed = (o: Partial<Purchase> = {}) =>
	approved({ state: 'completed', finalAmount: usd(17500), completedAt: NOW, ...o });

describe('requestApproval', () => {
	it('moves draft to pending with snapshot and timestamps', () => {
		const { purchase, event } = requestApproval(draft(), ['m-approver', 'm-other'], NOW);
		expect(purchase.state).toBe('pending_approval');
		expect(purchase.approverMemberIds).toEqual(['m-approver', 'm-other']);
		expect(purchase.requestedAt).toBe(NOW);
		expect(event).toMatchObject({ fromState: 'draft', toState: 'pending_approval' });
		expect(event.amountSnapshot?.minor).toBe(18000n);
	});

	it('rejects empty approver set', () => {
		expect(() => requestApproval(draft(), [], NOW)).toThrow(PurchaseStateError);
	});

	it('rejects from every non-draft state', () => {
		for (const p of [pending(), approved(), completed(), draft({ state: 'denied' })]) {
			expect(() => requestApproval(p, ['m-approver'], NOW)).toThrow(PurchaseStateError);
		}
	});
});

describe('autoApprove (exempt path)', () => {
	it('approves a draft without an actor', () => {
		const { purchase, event } = autoApprove(draft(), NOW, 'approval not required');
		expect(purchase.state).toBe('approved');
		expect(purchase.approvedAmount?.minor).toBe(18000n);
		expect(event.actorMemberId).toBeNull();
		expect(event.reason).toBe('approval not required');
	});
});

describe('approve', () => {
	it('approves at the requested amount', () => {
		const { purchase, event } = approve(pending(), 'm-approver', NOW);
		expect(purchase.state).toBe('approved');
		expect(purchase.approvedAmount?.minor).toBe(18000n);
		expect(purchase.decidedAt).toBe(NOW);
		expect(event.toState).toBe('approved');
	});

	it('rejects a non-approver, including the requester', () => {
		expect(() => approve(pending(), 'm-requester', NOW)).toThrow(PurchaseStateError);
		expect(() => approve(pending(), 'm-stranger', NOW)).toThrow(PurchaseStateError);
	});

	it('allows self-approval when the requester is in the approver set', () => {
		const p = pending({ approverMemberIds: ['m-requester'] });
		expect(approve(p, 'm-requester', NOW).purchase.state).toBe('approved');
	});

	it('does not call a first-time approval an overage', () => {
		// A logged purchase ("already bought") carries its final amount from the
		// start, so it reaches approval with finalAmount set but having never been
		// approved. Approving it still completes — the money is spent — but there
		// was no overage, and saying so confused people approving ordinary logs.
		const loggedAwaitingApproval = pending({
			finalAmount: usd(18000),
			approvedAmount: null,
			completedAt: NOW
		});
		const { purchase, event } = approve(loggedAwaitingApproval, 'm-approver', NOW);
		expect(purchase.state).toBe('completed');
		expect(event.reason).toBeNull();
	});

	it('completes directly when re-approving an overage', () => {
		const p = pending({ finalAmount: usd(25000), approvedAmount: usd(18000), completedAt: NOW });
		const { purchase, event } = approve(p, 'm-approver', NOW);
		expect(purchase.state).toBe('completed');
		expect(purchase.approvedAmount?.minor).toBe(25000n);
		expect(event.reason).toBe('overage approved');
	});

	it('rejects from non-pending states', () => {
		for (const p of [draft(), approved(), completed()]) {
			expect(() => approve(p, 'm-approver', NOW)).toThrow(PurchaseStateError);
		}
	});
});

describe('deny', () => {
	it('denies with a reason', () => {
		const { purchase, event } = deny(pending(), 'm-approver', 'too pricey', NOW);
		expect(purchase.state).toBe('denied');
		expect(event.reason).toBe('too pricey');
	});

	it('rejects non-approvers and non-pending states', () => {
		expect(() => deny(pending(), 'm-stranger', null, NOW)).toThrow(PurchaseStateError);
		expect(() => deny(approved(), 'm-approver', null, NOW)).toThrow(PurchaseStateError);
	});
});

describe('cancel', () => {
	it('cancels draft, pending, and approved — requester only', () => {
		for (const p of [draft(), pending(), approved()]) {
			expect(cancel(p, 'm-requester', NOW).purchase.state).toBe('cancelled');
			expect(() => cancel(p, 'm-approver', NOW)).toThrow(PurchaseStateError);
		}
	});

	it('never cancels settled states', () => {
		for (const state of ['denied', 'cancelled', 'completed', 'refunded'] as PurchaseState[]) {
			expect(() => cancel(draft({ state }), 'm-requester', NOW)).toThrow(PurchaseStateError);
		}
	});
});

describe('needsReapproval', () => {
	it('is false at or under the threshold, true above it', () => {
		// approved $180.00, threshold 10% → limit $198.00
		expect(needsReapproval(usd(18000), usd(19800), 10)).toBe(false); // exactly 10% over
		expect(needsReapproval(usd(18000), usd(19801), 10)).toBe(true); // one cent past
		expect(needsReapproval(usd(18000), usd(18000), 10)).toBe(false);
		expect(needsReapproval(usd(18000), usd(1), 10)).toBe(false); // underspend never
	});

	it('handles 0% threshold (any overage re-approves)', () => {
		expect(needsReapproval(usd(100), usd(101), 0)).toBe(true);
		expect(needsReapproval(usd(100), usd(100), 0)).toBe(false);
	});
});

describe('complete', () => {
	const FINAL_AT = new Date('2026-07-03T09:00:00Z');

	it('completes an approved purchase within threshold', () => {
		const { purchase, event } = complete(
			approved(),
			'm-requester',
			{ amount: usd(17500), at: FINAL_AT },
			10,
			NOW
		);
		expect(purchase.state).toBe('completed');
		expect(purchase.finalAmount?.minor).toBe(17500n);
		expect(purchase.completedAt).toBe(FINAL_AT);
		expect(event.toState).toBe('completed');
	});

	it('completes a draft directly (exempt log path)', () => {
		const { purchase } = complete(
			draft(),
			'm-requester',
			{ amount: usd(950), at: FINAL_AT },
			10,
			NOW
		);
		expect(purchase.state).toBe('completed');
	});

	it('auto-approved purchases (no approver snapshot) complete at any price', () => {
		const p = approved({ approverMemberIds: [] });
		const { purchase } = complete(p, 'm-requester', { amount: usd(99999), at: FINAL_AT }, 10, NOW);
		expect(purchase.state).toBe('completed');
	});

	it('returns to pending on overage past the threshold, resetting nudges', () => {
		const p = approved({ lastNudgedAt: NOW, nudgeCount: 3 });
		const { purchase, event } = complete(
			p,
			'm-requester',
			{ amount: usd(50000), at: FINAL_AT },
			10,
			NOW
		);
		expect(purchase.state).toBe('pending_approval');
		expect(purchase.finalAmount?.minor).toBe(50000n);
		expect(purchase.approvedAmount?.minor).toBe(18000n); // original approval kept for the diff
		expect(purchase.nudgeCount).toBe(0);
		expect(purchase.lastNudgedAt).toBeNull();
		expect(event.reason).toBe('overage');
	});

	it('rejects wrong actor, non-positive amounts, wrong states', () => {
		expect(() =>
			complete(approved(), 'm-approver', { amount: usd(1), at: FINAL_AT }, 10, NOW)
		).toThrow();
		expect(() =>
			complete(approved(), 'm-requester', { amount: usd(0), at: FINAL_AT }, 10, NOW)
		).toThrow();
		expect(() =>
			complete(approved(), 'm-requester', { amount: usd(-5), at: FINAL_AT }, 10, NOW)
		).toThrow();
		for (const p of [pending(), completed(), draft({ state: 'denied' })]) {
			expect(() => complete(p, 'm-requester', { amount: usd(1), at: FINAL_AT }, 10, NOW)).toThrow();
		}
	});
});

describe('edit', () => {
	it('invalidates approval on substantive change', () => {
		const { purchase, event } = edit(
			approved(),
			'm-requester',
			{ requestedAmount: usd(20000) },
			NOW
		);
		expect(purchase.state).toBe('pending_approval');
		expect(purchase.approvedAmount).toBeNull();
		expect(purchase.requestedAmount.minor).toBe(20000n);
		expect(event.reason).toBe('edited after approval');
	});

	it('item and category changes also invalidate; note-only does not', () => {
		expect(edit(approved(), 'm-requester', { itemName: 'Speakers' }, NOW).purchase.state).toBe(
			'pending_approval'
		);
		expect(edit(approved(), 'm-requester', { categoryId: 'cat-other' }, NOW).purchase.state).toBe(
			'pending_approval'
		);
		const noteOnly = edit(approved(), 'm-requester', { note: 'for the office' }, NOW);
		expect(noteOnly.purchase.state).toBe('approved');
		expect(noteOnly.purchase.approvedAmount?.minor).toBe(18000n);
	});

	it('no-op "changes" equal to current values do not invalidate', () => {
		const same = edit(
			approved(),
			'm-requester',
			{ itemName: 'Headphones', requestedAmount: usd(18000) },
			NOW
		);
		expect(same.purchase.state).toBe('approved');
	});

	it('an auto-approved purchase edits in place instead of stranding itself', () => {
		// "Ask first" under a policy that needs no approval lands here: approved
		// with zero approvers. Invalidating would send it to pending_approval with
		// nobody able to decide it, so the amount could never be corrected.
		const autoApproved = approved({ approverMemberIds: [] });
		const { purchase, event } = edit(
			autoApproved,
			'm-requester',
			{ requestedAmount: usd(22000) },
			NOW
		);
		expect(purchase.state).toBe('approved');
		expect(purchase.requestedAmount.minor).toBe(22000n);
		// The approved amount tracks the edit; leaving it stale would make the
		// purchase look like a 4,000 overage the moment it completes.
		expect(purchase.approvedAmount?.minor).toBe(22000n);
		expect(event.reason).toBe('edited');
	});

	it('still invalidates when there is someone who can re-approve', () => {
		const { purchase } = edit(approved(), 'm-requester', { requestedAmount: usd(22000) }, NOW);
		expect(purchase.state).toBe('pending_approval');
		expect(purchase.approvedAmount).toBeNull();
	});

	it('pending and draft edits keep their state', () => {
		expect(edit(pending(), 'm-requester', { requestedAmount: usd(1) }, NOW).purchase.state).toBe(
			'pending_approval'
		);
		expect(edit(draft(), 'm-requester', { itemName: 'X' }, NOW).purchase.state).toBe('draft');
	});

	it('rejects edits by others and on settled states', () => {
		expect(() => edit(approved(), 'm-approver', { note: 'hi' }, NOW)).toThrow(PurchaseStateError);
		for (const p of [completed(), draft({ state: 'denied' }), draft({ state: 'cancelled' })]) {
			expect(() => edit(p, 'm-requester', { note: 'hi' }, NOW)).toThrow(PurchaseStateError);
		}
	});
});

describe('markRefunded', () => {
	it('only completed purchases can be refunded', () => {
		expect(markRefunded(completed(), 'm-requester', NOW).purchase.state).toBe('refunded');
		for (const p of [draft(), pending(), approved(), draft({ state: 'cancelled' })]) {
			expect(() => markRefunded(p, 'm-requester', NOW)).toThrow(PurchaseStateError);
		}
	});
});
