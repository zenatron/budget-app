/**
 * Who may charge a purchase to a bucket.
 *
 * Bucket ownership used to be enforced on one side only. `loadOwnBucket` gates
 * every mutation, so nobody could rename or withdraw from a bucket that wasn't
 * theirs, while the charge path checked only that the bucket was in the
 * workspace and active. Any active member could spend out of anyone's bucket,
 * and a member kept to a cap could clear it by charging someone else's.
 *
 * Two settings close that, from opposite ends. A bucket names who may charge it
 * (`chargeMemberIds`), and a member can be held to the buckets they own
 * (`own_buckets_only`). Either one refusing is a refusal.
 *
 * Pure, so both the submit path and the recurring-rule path decide it the same
 * way, and both are testable without a database.
 */

export interface ChargeableBucket {
	/** The member the bucket belongs to. */
	memberId: string;
	/**
	 * Who else may charge it. Null means anyone in the workspace, which is what
	 * every bucket was before this existed. A list names exactly who; empty is
	 * therefore "only me". The owner is always allowed and never appears here,
	 * so the two can't contradict each other.
	 */
	chargeMemberIds: string[] | null;
}

export interface ChargeScope {
	/** The member doing the charging. */
	memberId: string;
	/** They may only charge buckets they own. */
	ownBucketsOnly: boolean;
}

/** Why a charge was refused. The two are worth telling apart. */
export type ChargeRefusal = 'not-listed' | 'restricted';

/**
 * Null means the charge is allowed. Otherwise, which rule turned it down —
 * one is about the bucket and the other is about the person, and the fix
 * differs, so the caller can say something true either way.
 */
export function refuseBucketCharge(
	bkt: ChargeableBucket,
	scope: ChargeScope
): ChargeRefusal | null {
	if (bkt.memberId === scope.memberId) return null;
	if (bkt.chargeMemberIds !== null && !bkt.chargeMemberIds.includes(scope.memberId)) {
		return 'not-listed';
	}
	if (scope.ownBucketsOnly) return 'restricted';
	return null;
}

/** The message for a refusal, shared by every charge path. */
export function chargeRefusalMessage(refusal: ChargeRefusal): string {
	return refusal === 'not-listed'
		? 'That bucket is limited to the people its owner picked'
		: 'You can only charge to your own buckets';
}

/**
 * How a bucket's charge scope reads in a list, given who is looking.
 *
 * Null is the quiet case and gets no label at all: "anyone can charge this" is
 * true of almost every bucket, so saying it would be noise on all of them and
 * would stop the restricted ones standing out.
 */
export function describeChargeScope(
	bkt: ChargeableBucket,
	viewerMemberId: string,
	nameOf: (memberId: string) => string
): string | null {
	if (bkt.chargeMemberIds === null) return null;
	const mine = bkt.memberId === viewerMemberId;
	if (bkt.chargeMemberIds.length === 0) return mine ? 'Only me' : `${nameOf(bkt.memberId)} only`;
	if (mine) {
		const others = bkt.chargeMemberIds.filter((id) => id !== viewerMemberId);
		return others.length === 1 ? `Me and ${nameOf(others[0])}` : `Me and ${others.length} others`;
	}
	const all = [bkt.memberId, ...bkt.chargeMemberIds];
	return all.length === 2
		? `${nameOf(all[0])} and ${nameOf(all[1])}`
		: `${all.length} people can charge this`;
}
