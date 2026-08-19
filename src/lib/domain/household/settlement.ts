/**
 * Household settlement — "who owes whom" over a period.
 *
 * The model is the one a shared household actually runs on: spending is
 * communal, so each member owes a *fair share* of the total, and the difference
 * between what they paid (purchases are attributed) and their share is either
 * money they owe the household or money the household owes them. Pairing the
 * two sides up gives the transfers that zero everyone out.
 *
 * Fair share comes in two honest flavours:
 *  - equal: the household splits spending evenly, whatever anyone earns;
 *  - income: shares track each member's income, so the bigger earner carries a
 *    bigger slice. A member with no income carries none of it — carried, not
 *    forgiven, by the others. If nobody recorded income, income-weighting has
 *    nothing to stand on and falls back to equal.
 *
 * Pure, like the rest of the domain: the caller gathers per-member income and
 * spending and hands them in. All math is bigint minor units — the shares sum
 * exactly to the total (largest-remainder allocation, the same property
 * Money.allocate guarantees for change) and the transfers sum exactly to zero
 * across both sides. Nothing rounds through a float at any point.
 */

export type ShareBasis = 'equal' | 'income';

export interface SettlementMember {
	memberId: string;
	name: string;
	/** Income this member recorded in the period. */
	incomeMinor: bigint;
	/** Shared spending attributed to this member in the period. */
	paidMinor: bigint;
}

export interface SettlementShare {
	memberId: string;
	name: string;
	/** The member's slice of the period's total spending. */
	fairShareMinor: bigint;
	paidMinor: bigint;
	/** fairShare − paid. Positive: owes the household. Negative: is owed. */
	owedMinor: bigint;
}

export interface SettlementTransfer {
	fromId: string;
	fromName: string;
	toId: string;
	toName: string;
	amountMinor: bigint;
}

export interface Settlement {
	basis: ShareBasis;
	totalSpentMinor: bigint;
	shares: SettlementShare[];
	/** The transfers that zero everyone out, largest first. */
	transfers: SettlementTransfer[];
}

/**
 * Split `total` across `weights` proportionally, largest-remainder so the
 * parts sum exactly. BigInt-native Money.allocate: incomes as weights run
 * straight past the safe-integer range allocate is bounded by.
 */
function allocateByWeights(total: bigint, weights: bigint[]): bigint[] {
	const weightTotal = weights.reduce((a, b) => a + b, 0n);
	const shares = weights.map((w) => (total * w) / weightTotal);
	// Floor division leaves a non-negative remainder when total ≥ 0; the
	// leftover minor units go to the largest remainders, earliest first.
	let leftover = total - shares.reduce((a, b) => a + b, 0n);
	const order = weights
		.map((w, i) => ({ i, r: (total * w) % weightTotal }))
		.sort((a, b) => (b.r === a.r ? a.i - b.i : b.r > a.r ? 1 : -1));
	for (const { i } of order) {
		if (leftover === 0n) break;
		shares[i] += 1n;
		leftover -= 1n;
	}
	return shares;
}

/** Pair the owing side against the owed side, biggest first, until both empty. */
function pairTransfers(members: SettlementMember[], owed: bigint[]): SettlementTransfer[] {
	const debtors = members
		.map((m, i) => ({ m, amount: owed[i] }))
		.filter((x) => x.amount > 0n)
		.sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
	const creditors = members
		.map((m, i) => ({ m, amount: -owed[i] }))
		.filter((x) => x.amount > 0n)
		.sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));

	const transfers: SettlementTransfer[] = [];
	let d = 0;
	let c = 0;
	while (d < debtors.length && c < creditors.length) {
		const amount =
			debtors[d].amount < creditors[c].amount ? debtors[d].amount : creditors[c].amount;
		if (amount > 0n) {
			transfers.push({
				fromId: debtors[d].m.memberId,
				fromName: debtors[d].m.name,
				toId: creditors[c].m.memberId,
				toName: creditors[c].m.name,
				amountMinor: amount
			});
		}
		debtors[d].amount -= amount;
		creditors[c].amount -= amount;
		if (debtors[d].amount === 0n) d++;
		if (creditors[c].amount === 0n) c++;
	}
	return transfers;
}

export function settleUp(members: SettlementMember[], basis: ShareBasis): Settlement {
	const totalSpent = members.reduce((a, m) => a + m.paidMinor, 0n);
	if (members.length === 0) {
		return { basis, totalSpentMinor: totalSpent, shares: [], transfers: [] };
	}

	// Income-weighting needs income to weight by; without any, the honest
	// answer is the equal split, not a division by zero.
	const anyIncome = members.some((m) => m.incomeMinor > 0n);
	const weights =
		basis === 'income' && anyIncome ? members.map((m) => m.incomeMinor) : members.map(() => 1n);
	const effectiveBasis = basis === 'income' && anyIncome ? 'income' : 'equal';

	const fair = allocateByWeights(totalSpent, weights);
	const owed = members.map((_, i) => fair[i] - members[i].paidMinor);

	return {
		basis: effectiveBasis,
		totalSpentMinor: totalSpent,
		shares: members.map((m, i) => ({
			memberId: m.memberId,
			name: m.name,
			fairShareMinor: fair[i],
			paidMinor: m.paidMinor,
			owedMinor: owed[i]
		})),
		transfers: pairTransfers(members, owed)
	};
}
