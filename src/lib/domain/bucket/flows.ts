/**
 * What actually moved through the buckets in a window — and how much of it was
 * real.
 *
 * A bucket is an earmark, not an account: nothing stops a charge against a
 * bucket that hasn't got the money, so a balance can go negative. That matters
 * because every period figure in the app used to read bucket movement as a
 * single signed sum ("savings this month"), which quietly conflated three
 * different events:
 *
 *   set aside — cash moved *into* a bucket. An outflow from spendable money.
 *   released  — cash taken *out* of a bucket that was genuinely there. Not this
 *               period's cost: it was set aside, and paid for, in some earlier
 *               period.
 *   overdraft — cash taken out of a bucket that *wasn't* there. Nothing funded
 *               it, so it is ordinary spending wearing a bucket's name.
 *
 * Netting them into one number made a withdrawal read as negative savings, and
 * a negative "set aside" then *added* to net position — crediting the household
 * for money it never set aside. Splitting them keeps the arithmetic honest:
 *
 *   net position = income − spent − setAside + released
 *
 * The released term cancels the bucket-funded part of `spent` (that cost landed
 * in the period the money was set aside), while the overdrafted part stays
 * counted against you, because nothing ever paid for it.
 *
 * Pure integer arithmetic over an ordered replay — no clock, no rounding, no
 * estimate. Transactions must arrive oldest-first: "was the money there?" is a
 * question about the balance as the window played out.
 *
 * It is asked about the window as a whole, though, not about the instant. Money
 * that lands later in the period covers a shortfall from earlier in it, so the
 * answer doesn't hinge on whether a charge beat the monthly accrual by an hour.
 * See the note on the inflow branch below.
 */

export interface BucketTxn {
	bucketId: string;
	/** Positive moves money in, negative takes it out. */
	amountMinor: bigint;
}

export interface BucketFlows {
	/** Money moved into buckets — accruals, deposits, credits. Never negative. */
	setAsideMinor: bigint;
	/** Money taken out that the bucket actually held. Never negative. */
	releasedMinor: bigint;
	/** Money taken out beyond the balance — spending nothing had funded. */
	overdraftMinor: bigint;
}

export const NO_FLOWS: BucketFlows = {
	setAsideMinor: 0n,
	releasedMinor: 0n,
	overdraftMinor: 0n
};

/**
 * Replay a period's transactions against the balances each bucket carried into
 * it, splitting withdrawals into the part the bucket could cover and the part
 * it couldn't.
 *
 * `openingBalances` is the sum of everything before the window, per bucket; a
 * bucket absent from the map opened at zero. A bucket that opened *overdrawn*
 * covers nothing until it is back above water — which is exactly right, since
 * paying an old overdraft down is what the later accruals are doing.
 *
 * The three figures reconcile with the raw signed sum by construction:
 * `setAside − released − overdraft` is the period's net change in balance.
 */
export function bucketFlows(
	openingBalances: ReadonlyMap<string, bigint>,
	txns: readonly BucketTxn[]
): BucketFlows {
	const balances = new Map(openingBalances);
	/**
	 * Shortfall incurred *inside this window*, per bucket, not yet covered.
	 *
	 * Deliberately not seeded from `openingBalances`: a bucket that arrived
	 * overdrawn owes that money to an earlier period, and this period's accruals
	 * paying it down is not this period releasing anything.
	 */
	const unfunded = new Map<string, bigint>();
	let setAsideMinor = 0n;
	let releasedMinor = 0n;
	let overdraftMinor = 0n;

	for (const t of txns) {
		const balance = balances.get(t.bucketId) ?? 0n;
		if (t.amountMinor >= 0n) {
			setAsideMinor += t.amountMinor;

			/*
			 * Money arriving later in the window pays off a shortfall from earlier in
			 * it, and that charge stops counting as unfunded.
			 *
			 * Without this the figures depend on the order of two events inside a
			 * single day. Charge an empty bucket at 08:00 and let the monthly accrual
			 * land at 09:00, and the charge is overdraft; do the same two things in
			 * the other order and it is funded — same day, same money, same closing
			 * balance, two different readings of the month.
			 *
			 * Worse, the first reading double-counts. The accrual is subtracted as
			 * savings *and* the charge is added to spending, so a household that spent
			 * £50 is shown £100 poorer. Reclassifying the covered part as released
			 * settles it at £50, which is what actually left.
			 *
			 * The inflow still counts in full as `setAside` — it genuinely moved in.
			 * Only the earlier withdrawal is re-read, moving from overdraft to
			 * released, which is what keeps the closing identity below intact.
			 */
			const debt = unfunded.get(t.bucketId) ?? 0n;
			if (debt > 0n) {
				const covered = t.amountMinor < debt ? t.amountMinor : debt;
				overdraftMinor -= covered;
				releasedMinor += covered;
				unfunded.set(t.bucketId, debt - covered);
			}
		} else {
			const wanted = -t.amountMinor;
			// An overdrawn bucket funds nothing, so the floor is zero rather than
			// the (negative) balance — otherwise a deeper hole would look like more
			// money available to release.
			const available = balance > 0n ? balance : 0n;
			const funded = wanted < available ? wanted : available;
			const short = wanted - funded;
			releasedMinor += funded;
			overdraftMinor += short;
			if (short > 0n) unfunded.set(t.bucketId, (unfunded.get(t.bucketId) ?? 0n) + short);
		}
		balances.set(t.bucketId, balance + t.amountMinor);
	}

	return { setAsideMinor, releasedMinor, overdraftMinor };
}

/**
 * How far a bucket would go under if `amountMinor` were charged to it — zero
 * when the balance covers it. The friction check the UI puts in front of a
 * charge, and the same arithmetic `bucketFlows` does after the fact, so the
 * warning and the ledger can never disagree.
 */
export function overdraftBy(balanceMinor: bigint, amountMinor: bigint): bigint {
	if (amountMinor <= 0n) return 0n;
	const available = balanceMinor > 0n ? balanceMinor : 0n;
	const short = amountMinor - available;
	return short > 0n ? short : 0n;
}
