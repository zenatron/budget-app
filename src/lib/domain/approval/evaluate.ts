import type { Money } from '../money/money';
import type { ApprovalPolicy } from './policy';

/** What else about the purchase can override the base mode. */
export interface ApprovalContext {
	/** Paid out of a bucket rather than general spending. */
	chargedToBucket?: boolean;
	/** The workspace-wide default a member's 'inherit' defers to. */
	workspaceSkipsBucketCharges?: boolean;
	/** The charge is bigger than what the bucket currently holds. */
	bucketWouldOverdraw?: boolean;
}

/**
 * Does this member's purchase need approval under their policy?
 *
 * Two kinds of statement can override the base mode — a category override and,
 * for a bucket-charged purchase, the member's bucket rule — and they can
 * disagree. The rule is that **requirements beat exemptions**: if anything says
 * this needs approving, it does. Failing towards asking is recoverable; failing
 * towards silence spends someone else's money without them hearing about it.
 *
 * An amount at or above the threshold (mode 'threshold') requires approval.
 *
 * A member held to their own buckets (`own_buckets_only`) keeps the bucket
 * exemption only while the bucket can cover the charge. Overdrawing one spends
 * money that was never set aside, which is ordinary spending wearing a bucket's
 * name, so it falls back to the base mode and someone gets asked. That is the
 * cap in an allowance: free underneath it, ask first to go past.
 */
export function approvalRequired(
	policy: ApprovalPolicy,
	amount: Money,
	categoryId: string | null,
	ctx: ApprovalContext = {}
): boolean {
	const override = categoryId ? policy.category_overrides?.[categoryId] : undefined;
	const bucketRule = policy.bucket_charges ?? 'inherit';
	const overdrawsAllowance = policy.own_buckets_only === true && ctx.bucketWouldOverdraw === true;
	const bucketExempt =
		ctx.chargedToBucket === true &&
		!overdrawsAllowance &&
		(bucketRule === 'skip' ||
			(bucketRule === 'inherit' && ctx.workspaceSkipsBucketCharges === true));

	if (override === 'always') return true;
	if (ctx.chargedToBucket === true && bucketRule === 'require') return true;
	if (override === 'exempt') return false;
	if (bucketExempt) return false;

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
/**
 * Who may decide a purchase *right now*, under the requester's current policy.
 *
 * The lenient sibling of `resolveApprovers`. That one is for the write path —
 * it throws, deliberately, so a purchase can never be created with nobody able
 * to approve it. This one answers a question about an existing request, on the
 * read path, where throwing would take out the ledger page instead of the one
 * row it couldn't resolve. An unresolvable policy here simply yields nobody,
 * and the caller unions this with the snapshot, so the people originally asked
 * still stand.
 *
 * Routing, not mode, decides this. `mode` governs whether a *new* purchase
 * needs approving at all; a request that is already pending needs someone to
 * decide it whatever the mode has since been changed to. And `specific` is not
 * enforced here — a policy that has drifted to two named approvers is a
 * misconfiguration to fix, not a reason to strand a pending request.
 */
export function eligibleApprovers(policy: ApprovalPolicy, activeMemberIds: string[]): string[] {
	const ids = policy?.routing?.approver_ids;
	if (!Array.isArray(ids)) return [];
	return ids.filter((id) => activeMemberIds.includes(id));
}

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
