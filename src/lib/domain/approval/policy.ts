/**
 * Per-member approval policy, stored as jsonb on workspace_member.
 * Describes when *that member's own* spending needs approval and who decides.
 * Approval is not symmetric: being an approver and needing approval are independent.
 */
/**
 * What a member's own bucket-charged purchases do.
 *
 * `inherit` defers to the workspace-wide setting, and is what an absent value
 * means — so adding this field changed nobody's behaviour.
 */
export type BucketChargeRule = 'inherit' | 'skip' | 'require';

export const BUCKET_CHARGE_RULES = ['inherit', 'skip', 'require'] as const;

export interface ApprovalPolicy {
	mode: 'none' | 'threshold' | 'always';
	/** Minor units; required when mode is 'threshold'. */
	threshold_minor?: number;
	/** categoryId -> exemption/override of the base mode. */
	category_overrides?: Record<string, 'exempt' | 'always'>;
	/** Absent means 'inherit'. */
	bucket_charges?: BucketChargeRule;
	routing: {
		/** any_of: any listed approver satisfies. specific: exactly that one member. */
		mode: 'any_of' | 'specific';
		approver_ids: string[];
	};
}

/** New members start needing no approval; the workspace owner tunes this later. */
export function defaultApprovalPolicy(): ApprovalPolicy {
	return { mode: 'none', routing: { mode: 'any_of', approver_ids: [] } };
}

/**
 * Whose spending would break if `leavingId` stopped being an active member.
 *
 * `resolveApprovers` throws when a policy that needs approval has no active
 * approver left, and it throws at the moment someone tries to buy something —
 * long after the change that caused it, to a person who had nothing to do with
 * it. Disabling the household's only approver is an easy mistake to make and an
 * obscure one to diagnose, so it is checked up front instead.
 *
 * Returns the member ids that would be stranded; empty means the change is safe.
 */
export function strandedByRemoving(
	members: { id: string; policy: ApprovalPolicy; status: string }[],
	leavingId: string
): string[] {
	const remaining = members
		.filter((m) => m.status === 'active' && m.id !== leavingId)
		.map((m) => m.id);

	return members
		.filter((m) => m.status === 'active' && m.id !== leavingId)
		.filter((m) => {
			const canRequire =
				m.policy.mode !== 'none' ||
				m.policy.bucket_charges === 'require' ||
				Object.values(m.policy.category_overrides ?? {}).some((o) => o === 'always');
			if (!canRequire) return false;
			return m.policy.routing.approver_ids.filter((id) => remaining.includes(id)).length === 0;
		})
		.map((m) => m.id);
}

export class InvalidPolicyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidPolicyError';
	}
}

/**
 * Enforce policy invariants against the workspace's active member ids:
 * a policy that can require approval must name at least one (active) approver;
 * 'specific' names exactly one; thresholds must be sane.
 */
export function validatePolicy(policy: ApprovalPolicy, activeMemberIds: string[]): void {
	const { mode, routing } = policy;
	const canRequireApproval =
		mode !== 'none' || Object.values(policy.category_overrides ?? {}).some((o) => o === 'always');
	if (mode === 'threshold') {
		const t = policy.threshold_minor;
		if (t === undefined || !Number.isSafeInteger(t) || t < 0) {
			throw new InvalidPolicyError('Threshold must be a non-negative amount');
		}
	}
	if (routing.mode === 'specific' && routing.approver_ids.length !== 1) {
		throw new InvalidPolicyError("Routing 'specific' must name exactly one approver");
	}
	if (canRequireApproval) {
		if (routing.approver_ids.length === 0) {
			throw new InvalidPolicyError('Name at least one approver');
		}
		const inactive = routing.approver_ids.filter((id) => !activeMemberIds.includes(id));
		if (inactive.length > 0) {
			throw new InvalidPolicyError('Approvers must be active members of this workspace');
		}
	}
}
