import { describe, expect, it } from 'vitest';
import { SealError, approversNotConcealed, isConcealedFrom, isSealed, validateSeal } from './seal';

const NOW = new Date('2026-07-01T12:00:00Z');
const IN_7_DAYS = new Date('2026-07-08T12:00:00Z');
const ctx = {
	now: NOW,
	maxSealDays: 90,
	requesterMemberId: 'me',
	activeMemberIds: ['me', 'alice', 'bob']
};

describe('validateSeal', () => {
	it('accepts a valid seal', () => {
		expect(() =>
			validateSeal({ sealedUntil: IN_7_DAYS, sealedFromMemberIds: ['alice'] }, ctx)
		).not.toThrow();
	});

	it('requires at least one concealed member', () => {
		expect(() => validateSeal({ sealedUntil: IN_7_DAYS, sealedFromMemberIds: [] }, ctx)).toThrow(
			SealError
		);
	});

	it('rejects sealing from yourself', () => {
		expect(() =>
			validateSeal({ sealedUntil: IN_7_DAYS, sealedFromMemberIds: ['alice', 'me'] }, ctx)
		).toThrow(SealError);
	});

	it('rejects non-members and duplicates', () => {
		expect(() =>
			validateSeal({ sealedUntil: IN_7_DAYS, sealedFromMemberIds: ['stranger'] }, ctx)
		).toThrow(SealError);
		expect(() =>
			validateSeal({ sealedUntil: IN_7_DAYS, sealedFromMemberIds: ['alice', 'alice'] }, ctx)
		).toThrow(SealError);
	});

	it('requires a future unlock within max_seal_days', () => {
		expect(() => validateSeal({ sealedUntil: NOW, sealedFromMemberIds: ['alice'] }, ctx)).toThrow(
			SealError
		);
		expect(() =>
			validateSeal(
				{ sealedUntil: new Date('2026-06-30T00:00:00Z'), sealedFromMemberIds: ['alice'] },
				ctx
			)
		).toThrow(SealError);
		const dayPastMax = new Date(NOW.getTime() + 91 * 86_400_000);
		expect(() =>
			validateSeal({ sealedUntil: dayPastMax, sealedFromMemberIds: ['alice'] }, ctx)
		).toThrow(SealError);
		const exactlyMax = new Date(NOW.getTime() + 90 * 86_400_000);
		expect(() =>
			validateSeal({ sealedUntil: exactlyMax, sealedFromMemberIds: ['alice'] }, ctx)
		).not.toThrow();
	});
});

describe('isConcealedFrom / isSealed', () => {
	const sealed = { sealedUntil: IN_7_DAYS, sealedFromMemberIds: ['alice'] };

	it('conceals only listed members, only while active', () => {
		expect(isConcealedFrom(sealed, 'alice', NOW)).toBe(true);
		expect(isConcealedFrom(sealed, 'bob', NOW)).toBe(false);
		expect(isConcealedFrom(sealed, 'alice', new Date('2026-07-08T12:00:01Z'))).toBe(false);
		expect(isConcealedFrom(sealed, 'alice', IN_7_DAYS)).toBe(false); // boundary: expired at ==
	});

	it('unsealed rows conceal nobody', () => {
		expect(isConcealedFrom({ sealedUntil: null, sealedFromMemberIds: [] }, 'alice', NOW)).toBe(
			false
		);
		expect(isConcealedFrom({ sealedUntil: IN_7_DAYS, sealedFromMemberIds: [] }, 'alice', NOW)).toBe(
			false
		);
		// cleared list but until in future (manual early unseal keeps the date as history)
		expect(isSealed({ sealedUntil: IN_7_DAYS, sealedFromMemberIds: [] }, NOW)).toBe(false);
	});

	it('isSealed tracks the seal being in force at all', () => {
		expect(isSealed(sealed, NOW)).toBe(true);
		expect(isSealed(sealed, new Date('2026-08-01T00:00:00Z'))).toBe(false);
	});
});

describe('approversNotConcealed (approval × seal conflict)', () => {
	it('routes to approvers who can see the purchase', () => {
		const seal = { sealedUntil: IN_7_DAYS, sealedFromMemberIds: ['alice'] };
		expect(approversNotConcealed(['alice', 'bob'], seal)).toEqual(['bob']);
	});

	it('returns empty when every approver is concealed (caller must disclose)', () => {
		const seal = { sealedUntil: IN_7_DAYS, sealedFromMemberIds: ['alice', 'bob'] };
		expect(approversNotConcealed(['alice', 'bob'], seal)).toEqual([]);
	});
});
