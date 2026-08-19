import { describe, expect, it } from 'vitest';
import { chargeRefusalMessage, describeChargeScope, refuseBucketCharge } from './scope';

const owner = 'm-owner';
const other = 'm-other';
const third = 'm-third';

const open = { memberId: owner, chargeMemberIds: null };
const onlyOwner = { memberId: owner, chargeMemberIds: [] };
const ownerAndOther = { memberId: owner, chargeMemberIds: [other] };

const NAMES: Record<string, string> = { [owner]: 'Ada', [other]: 'Bo', [third]: 'Cy' };
const nameOf = (id: string) => NAMES[id] ?? 'someone';

describe('refuseBucketCharge', () => {
	it('the owner may always charge their own bucket', () => {
		expect(refuseBucketCharge(open, { memberId: owner, ownBucketsOnly: false })).toBeNull();
		expect(refuseBucketCharge(onlyOwner, { memberId: owner, ownBucketsOnly: false })).toBeNull();
		// Even held to their own buckets, this is one of them.
		expect(refuseBucketCharge(onlyOwner, { memberId: owner, ownBucketsOnly: true })).toBeNull();
	});

	it('an unrestricted bucket is open to anyone', () => {
		expect(refuseBucketCharge(open, { memberId: other, ownBucketsOnly: false })).toBeNull();
	});

	it('an empty list refuses everyone but the owner', () => {
		expect(refuseBucketCharge(onlyOwner, { memberId: other, ownBucketsOnly: false })).toBe(
			'not-listed'
		);
	});

	it('a named member may charge it; nobody else may', () => {
		expect(
			refuseBucketCharge(ownerAndOther, { memberId: other, ownBucketsOnly: false })
		).toBeNull();
		expect(refuseBucketCharge(ownerAndOther, { memberId: third, ownBucketsOnly: false })).toBe(
			'not-listed'
		);
	});

	it('a restricted member is refused even an open bucket', () => {
		expect(refuseBucketCharge(open, { memberId: other, ownBucketsOnly: true })).toBe('restricted');
		// And being named on it does not lift their own restriction.
		expect(refuseBucketCharge(ownerAndOther, { memberId: other, ownBucketsOnly: true })).toBe(
			'restricted'
		);
	});

	it('the bucket rule is named first when both apply', () => {
		// Both would refuse. Naming the bucket is the more useful answer: the
		// person can see the bucket, and cannot see their own policy.
		expect(refuseBucketCharge(onlyOwner, { memberId: other, ownBucketsOnly: true })).toBe(
			'not-listed'
		);
	});

	it('every refusal has a message', () => {
		expect(chargeRefusalMessage('not-listed')).toMatch(/its owner picked/);
		expect(chargeRefusalMessage('restricted')).toMatch(/your own buckets/);
	});
});

describe('describeChargeScope', () => {
	it('says nothing about a bucket anyone can charge', () => {
		// True of almost every bucket, so a label would be noise on all of them.
		expect(describeChargeScope(open, owner, nameOf)).toBeNull();
		expect(describeChargeScope(open, other, nameOf)).toBeNull();
	});

	it('names the owner from the outside and says "me" from the inside', () => {
		expect(describeChargeScope(onlyOwner, owner, nameOf)).toBe('Only me');
		expect(describeChargeScope(onlyOwner, other, nameOf)).toBe('Ada only');
	});

	it('reads the shared case from either side', () => {
		expect(describeChargeScope(ownerAndOther, owner, nameOf)).toBe('Me and Bo');
		expect(describeChargeScope(ownerAndOther, other, nameOf)).toBe('Ada and Bo');
		expect(describeChargeScope(ownerAndOther, third, nameOf)).toBe('Ada and Bo');
	});

	it('counts rather than lists once there are several', () => {
		const many = { memberId: owner, chargeMemberIds: [other, third] };
		expect(describeChargeScope(many, owner, nameOf)).toBe('Me and 2 others');
		expect(describeChargeScope(many, third, nameOf)).toBe('3 people can charge this');
	});
});
