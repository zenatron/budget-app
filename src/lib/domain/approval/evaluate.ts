import type { Money } from '../money/money';
import type { ApprovalPolicy } from './policy';

/**
 * Does this member's purchase need approval under their policy?
 * Category overrides beat the base mode; an amount at or above the threshold
 * (mode 'threshold') requires approval.
 */
export function approvalRequired(
	policy: ApprovalPolicy,
	amount: Money,
	categoryId: string | null
): boolean {
	const override = categoryId ? policy.category_overrides?.[categoryId] : undefined;
	if (override === 'exempt') return false;
	if (override === 'always') return true;
	switch (policy.mode) {
		case 'none':
			return false;
		case 'always':
			return true;
		case 'threshold': {
			const threshold = policy.threshold_minor;
			if (threshold === undefined || !Number.isSafeInteger(threshold) || threshold < 0) {
				// A broken threshold fails safe: approval required.
				return true;
			}
			return amount.minor >= BigInt(threshold);
		}
	}
}

export class ApprovalRoutingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ApprovalRoutingError';
	}
}

/**
 * Resolve who may decide, given the policy and the workspace's active member
 * ids. Returns the snapshot to persist on the request. Self-approval is not a
 * special case — the requester may legitimately be in the returned set.
 */
export function resolveApprovers(policy: ApprovalPolicy, activeMemberIds: string[]): string[] {
	const { mode, approver_ids } = policy.routing;
	const active = approver_ids.filter((id) => activeMemberIds.includes(id));
	if (mode === 'specific') {
		if (approver_ids.length !== 1) {
			throw new ApprovalRoutingError("Routing mode 'specific' must name exactly one approver");
		}
		if (active.length !== 1) {
			throw new ApprovalRoutingError('The designated approver is not an active member');
		}
		return active;
	}
	if (active.length === 0) {
		throw new ApprovalRoutingError('Approval required but no active approvers are configured');
	}
	return active;
}
