import { describe, it, expect, vi } from 'vitest';
import { suggestMatch } from './suggest-match';
import type { MatchCandidate } from '$lib/domain/reconcile/match';
import { fakeAssist } from '$lib/ports/fake-assist';
import type { LlmAssist } from '$lib/ports/llm-assist';

const candidate = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
	id: 'p-1',
	amountMinor: 420n,
	completedAt: new Date('2026-08-04T10:00:00Z'),
	itemName: 'flat white',
	merchantName: 'Blue Bottle',
	...over
});

const LINE = {
	rawDescription: 'SQ *BLUE BOTTLE 0042 SEATTLE WA',
	amountMinor: 420n,
	postedAt: new Date('2026-08-05T00:00:00Z'),
	currency: 'USD'
};

describe('suggestMatch — it can only ever return an id we handed it', () => {
	it('returns the picked candidate', async () => {
		const out = await suggestMatch(fakeAssist({ pickChoice: async () => 'p-1' }), LINE, [
			candidate()
		]);
		expect(out).toBe('p-1');
	});

	it('drops an id that is not one of the candidates', async () => {
		// constrainToChoice already refuses invention inside the adapter; this is
		// the second check, against the real rows, that suggestCategory also does.
		const out = await suggestMatch(fakeAssist({ pickChoice: async () => 'p-not-offered' }), LINE, [
			candidate()
		]);
		expect(out).toBeNull();
	});

	it('returns null when the model abstains', async () => {
		const out = await suggestMatch(fakeAssist({ pickChoice: async () => null }), LINE, [
			candidate()
		]);
		expect(out).toBeNull();
	});
});

describe('suggestMatch — no model, no call', () => {
	it('returns null and asks nothing when the assist is off', async () => {
		const pickChoice = vi.fn(async () => 'p-1');
		const out = await suggestMatch(fakeAssist({ available: false, pickChoice }), LINE, [
			candidate()
		]);

		expect(out).toBeNull();
		expect(pickChoice).not.toHaveBeenCalled();
	});

	it('returns null and asks nothing when there is nothing to choose between', async () => {
		const pickChoice = vi.fn(async () => 'p-1');
		const out = await suggestMatch(fakeAssist({ pickChoice }), LINE, []);

		expect(out).toBeNull();
		expect(pickChoice).not.toHaveBeenCalled();
	});
});

describe('suggestMatch — what the model is shown', () => {
	it('labels each candidate with item, merchant, amount and date', async () => {
		const pickChoice = vi.fn<LlmAssist['pickChoice']>(async () => null);
		await suggestMatch(fakeAssist({ pickChoice }), LINE, [candidate()]);

		expect(pickChoice.mock.calls[0][0].choices).toEqual([
			{ id: 'p-1', label: 'flat white at Blue Bottle · $4.20 on 2026-08-04' }
		]);
	});

	it('omits the merchant clause when there is no merchant', async () => {
		const pickChoice = vi.fn<LlmAssist['pickChoice']>(async () => null);
		await suggestMatch(fakeAssist({ pickChoice }), LINE, [candidate({ merchantName: null })]);

		expect(pickChoice.mock.calls[0][0].choices[0].label).toBe('flat white · $4.20 on 2026-08-04');
	});

	it('shows magnitudes, so a debit recorded as negative still reads as money', async () => {
		const pickChoice = vi.fn<LlmAssist['pickChoice']>(async () => null);
		await suggestMatch(fakeAssist({ pickChoice }), { ...LINE, amountMinor: -420n }, [
			candidate({ amountMinor: -420n })
		]);

		const req = pickChoice.mock.calls[0][0];
		expect(req.choices[0].label).toContain('$4.20');
		expect(req.context).toContainEqual({ label: 'Amount', value: '$4.20' });
	});

	it('sends the bank’s words verbatim as the text to decode', async () => {
		const pickChoice = vi.fn<LlmAssist['pickChoice']>(async () => null);
		await suggestMatch(fakeAssist({ pickChoice }), LINE, [candidate()]);

		expect(pickChoice.mock.calls[0][0].text).toBe('SQ *BLUE BOTTLE 0042 SEATTLE WA');
	});

	it('teaches abstention by example', async () => {
		const pickChoice = vi.fn<LlmAssist['pickChoice']>(async () => null);
		await suggestMatch(fakeAssist({ pickChoice }), LINE, [candidate()]);

		expect(pickChoice.mock.calls[0][0].examples).toContainEqual({
			text: 'ACH DEBIT 8891002',
			answer: 'NONE'
		});
	});
});

describe('suggestMatch — the shortlist', () => {
	it('offers the candidates nearest the posting date first', async () => {
		const pickChoice = vi.fn<LlmAssist['pickChoice']>(async () => null);
		const far = candidate({ id: 'far', completedAt: new Date('2026-07-01T00:00:00Z') });
		const near = candidate({ id: 'near', completedAt: new Date('2026-08-05T00:00:00Z') });
		const mid = candidate({ id: 'mid', completedAt: new Date('2026-08-01T00:00:00Z') });

		await suggestMatch(fakeAssist({ pickChoice }), LINE, [far, near, mid]);

		expect(pickChoice.mock.calls[0][0].choices.map((c) => c.id)).toEqual(['near', 'mid', 'far']);
	});

	it('caps the list, and a candidate that was cut cannot be returned', async () => {
		const many = Array.from({ length: 40 }, (_, i) =>
			candidate({
				id: `p-${i}`,
				// Later index = further from the posting date, so p-30 is cut.
				completedAt: new Date(Date.UTC(2026, 7, 5) - i * 86_400_000)
			})
		);
		const pickChoice = vi.fn<LlmAssist['pickChoice']>(async () => 'p-30');

		const out = await suggestMatch(fakeAssist({ pickChoice }), LINE, many);

		expect(pickChoice.mock.calls[0][0].choices).toHaveLength(25);
		expect(out).toBeNull();
	});

	it('does not mutate the caller’s candidate array', async () => {
		const list = [
			candidate({ id: 'far', completedAt: new Date('2026-07-01T00:00:00Z') }),
			candidate({ id: 'near', completedAt: new Date('2026-08-05T00:00:00Z') })
		];
		await suggestMatch(fakeAssist(), LINE, list);
		expect(list.map((c) => c.id)).toEqual(['far', 'near']);
	});
});
