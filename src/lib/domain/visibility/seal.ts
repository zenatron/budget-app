/**
 * Sealed purchases (the gift case). Security-critical rules:
 *
 * - For a concealed viewer the purchase does not exist at all — not the row,
 *   not its amount, not its effect on any aggregate. Enforced in SQL by
 *   `visibleTo` (repo layer); `isConcealedFrom` is the same predicate in pure
 *   TS for non-SQL surfaces (SSE, push payload filtering).
 * - Seals always expire (workspace max_seal_days, default 90). Unsealing is
 *   one-way: automatic on a sweep, or early by the requester. Never by anyone
 *   else — including the workspace owner.
 * - Seal creation and unsealing are audit-logged: private until unseal, not
 *   secret after it.
 */

const DAY_MS = 86_400_000;

export class SealError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SealError';
	}
}

export interface SealSpec {
	sealedUntil: Date;
	sealedFromMemberIds: string[];
}

export function validateSeal(
	spec: SealSpec,
	ctx: {
		now: Date;
		maxSealDays: number;
		requesterMemberId: string;
		activeMemberIds: string[];
	}
): void {
	if (spec.sealedFromMemberIds.length === 0) {
		throw new SealError('A seal must hide the purchase from at least one member');
	}
	if (spec.sealedFromMemberIds.includes(ctx.requesterMemberId)) {
		throw new SealError('You cannot hide a purchase from yourself');
	}
	const unknown = spec.sealedFromMemberIds.filter((id) => !ctx.activeMemberIds.includes(id));
	if (unknown.length > 0) {
		throw new SealError('Seals can only hide from active members of this workspace');
	}
	if (new Set(spec.sealedFromMemberIds).size !== spec.sealedFromMemberIds.length) {
		throw new SealError('Duplicate members in seal list');
	}
	if (spec.sealedUntil.getTime() <= ctx.now.getTime()) {
		throw new SealError('The unlock time must be in the future');
	}
	if (spec.sealedUntil.getTime() > ctx.now.getTime() + ctx.maxSealDays * DAY_MS) {
		throw new SealError(`Seals cannot last longer than ${ctx.maxSealDays} days`);
	}
}

export interface Sealable {
	sealedUntil: Date | null;
	sealedFromMemberIds: string[];
}

/** True while the seal is active *and* the viewer is on the concealed list. */
export function isConcealedFrom(p: Sealable, viewerMemberId: string, now: Date): boolean {
	return (
		p.sealedFromMemberIds.includes(viewerMemberId) &&
		p.sealedUntil !== null &&
		p.sealedUntil.getTime() > now.getTime()
	);
}

/** Is the seal still in force against anyone? */
export function isSealed(p: Sealable, now: Date): boolean {
	return (
		p.sealedFromMemberIds.length > 0 &&
		p.sealedUntil !== null &&
		p.sealedUntil.getTime() > now.getTime()
	);
}

/**
 * Approval × sealing conflict rule, applied in this order:
 * 1. Approvers who are not concealed-from may decide — route to them.
 * 2. If every approver is concealed, the caller must fall back to a disclosed
 *    auto-approval (never a silent skip). This function only does step 1.
 */
export function approversNotConcealed(approverMemberIds: string[], seal: SealSpec): string[] {
	return approverMemberIds.filter((id) => !seal.sealedFromMemberIds.includes(id));
}
