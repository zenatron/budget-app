/**
 * The Month-End Statement — Harmony's close of the books.
 *
 * At month's end (or mid-flight, "so far"), this reads back the month in plain
 * language: what came in, what went out, what was set aside, and where you
 * landed. Same covenant as Safe to Spend — the arithmetic is done elsewhere on
 * honest integers; this file only *interprets* the totals into sentences. No
 * figure is invented here, and nothing is said that the numbers don't support.
 *
 * The one rule that shapes every sentence: only speak to net position when
 * income is actually recorded. Income is optional in this app, and a household
 * that never logs a paycheck would otherwise read every month as a catastrophe
 * ("you ended $2,000 behind") purely because the top line is missing. When
 * income is zero we describe the spending and stay quiet about the balance.
 */

export interface MonthStatementFigures {
	/** Completed spend this month, net of refunds. Seal-scoped to the viewer. */
	spentMinor: bigint;
	/** The same figure for the month before, for a like-for-like comparison. */
	prevSpentMinor: bigint;
	/** Income received this month. May be 0 if the household doesn't track it. */
	incomeMinor: bigint;
	/** Bucket accruals this month — cash deliberately moved into savings. */
	savingsMinor: bigint;
	/** Number of completed purchases, for texture ("across 34 purchases"). */
	txCount: number;
	/** The category the most went to, if any spending happened. */
	topCategory: { name: string; totalMinor: bigint } | null;
	/** The single heaviest day, keyed 'YYYY-MM-DD', if any spending happened. */
	biggestDay: { key: string; totalMinor: bigint } | null;
	/** The overall plan for the month, if one was set. */
	budget: { limitMinor: bigint; actualMinor: bigint } | null;
	/** True while the month is still running — changes tense and hedges claims. */
	isPartial: boolean;
}

export type MonthStatus = 'saved' | 'even' | 'over' | 'neutral';

export interface MonthSummary {
	/** income − spent − savings. Only meaningful when income was recorded. */
	netMinor: bigint;
	/** Share of income set aside, in basis points. Null when income is 0. */
	savingsRateBps: number | null;
	/** spent − prevSpent. Positive means you spent more than last month. */
	momDeltaMinor: bigint;
	/** Month-over-month change as a whole percent. Null when last month was 0. */
	momDeltaPct: number | null;
	/** limit − actual for the overall plan. Positive is room to spare. Null if unplanned. */
	budgetVarianceMinor: bigint | null;
	/**
	 * The month's verdict. 'neutral' when income is untracked (we can't judge a
	 * balance we can't see); otherwise saved / even / over on the net figure.
	 */
	status: MonthStatus;
}

export function summarizeMonth(f: MonthStatementFigures): MonthSummary {
	const netMinor = f.incomeMinor - f.spentMinor - f.savingsMinor;
	const hasIncome = f.incomeMinor > 0n;
	const savingsRateBps = hasIncome ? Number((f.savingsMinor * 10_000n) / f.incomeMinor) : null;
	const momDeltaMinor = f.spentMinor - f.prevSpentMinor;
	const momDeltaPct =
		f.prevSpentMinor > 0n ? Number((momDeltaMinor * 100n) / f.prevSpentMinor) : null;
	const budgetVarianceMinor = f.budget ? f.budget.limitMinor - f.budget.actualMinor : null;

	const status: MonthStatus = !hasIncome
		? 'neutral'
		: netMinor > 0n
			? 'saved'
			: netMinor < 0n
				? 'over'
				: 'even';

	return { netMinor, savingsRateBps, momDeltaMinor, momDeltaPct, budgetVarianceMinor, status };
}

export interface MonthNarration {
	tone: MonthStatus | 'budget';
	/** The lead — the one sentence that frames the month. */
	lead: string;
	/** Supporting, strictly-derived observations. Any may be absent. */
	notes: string[];
}

/**
 * Compose the statement's prose. `fmt` renders minor units the caller's way
 * (currency, locale), keeping this a pure string-shaping function. The lead is
 * chosen by the same principle as Safe to Spend: say the truest, most useful
 * thing first, and never manufacture drama the figures don't hold.
 */
export function narrateMonth(
	f: MonthStatementFigures,
	fmt: (minor: bigint) => string
): MonthNarration {
	const s = summarizeMonth(f);
	const opener = f.isPartial ? 'So far this month, you' : 'You';
	const openerLower = f.isPartial ? 'so far this month' : 'this month';
	const notes: string[] = [];

	// --- The lead ------------------------------------------------------------
	let tone: MonthNarration['tone'];
	let lead: string;

	if (s.status === 'neutral') {
		// No income to balance against: describe the spending, judge nothing.
		tone = 'neutral';
		if (f.spentMinor === 0n) {
			lead = f.isPartial
				? 'Nothing spent yet this month. A clean page.'
				: 'Nothing went out this month. A clean page.';
		} else {
			const count = f.txCount === 1 ? '1 purchase' : `${f.txCount} purchases`;
			lead = `${opener} spent ${fmt(f.spentMinor)} across ${count}.`;
		}
	} else if (s.status === 'over') {
		tone = 'over';
		const behind = fmt(-s.netMinor);
		lead =
			f.savingsMinor > 0n
				? `${fmt(f.incomeMinor)} came in and ${fmt(f.spentMinor)} went out. After ${fmt(f.savingsMinor)} set aside, you're ${behind} behind ${openerLower}.`
				: `${fmt(f.incomeMinor)} came in and ${fmt(f.spentMinor)} went out, leaving you ${behind} behind ${openerLower}.`;
	} else if (s.status === 'even') {
		tone = 'even';
		lead = `${fmt(f.incomeMinor)} in, ${fmt(f.spentMinor)} out, ${fmt(f.savingsMinor)} saved. You broke exactly even ${openerLower}.`;
	} else {
		// saved
		tone = 'saved';
		const ahead = fmt(s.netMinor);
		lead =
			f.savingsMinor > 0n
				? `${fmt(f.incomeMinor)} came in against ${fmt(f.spentMinor)} out. You set aside ${fmt(f.savingsMinor)} and still closed ${ahead} ahead.`
				: `${fmt(f.incomeMinor)} came in against ${fmt(f.spentMinor)} out, leaving you ${ahead} ahead ${openerLower}.`;
		if (f.isPartial) {
			// "Closed ahead" overclaims a month that hasn't ended.
			lead = lead.replace('closed', 'sitting').replace(`ahead ${openerLower}`, `ahead so far`);
		}
	}

	// --- Supporting notes ----------------------------------------------------
	// Where it went.
	if (f.topCategory && f.topCategory.totalMinor > 0n && f.spentMinor > 0n) {
		const share = Number((f.topCategory.totalMinor * 100n) / f.spentMinor);
		notes.push(
			`Most of it went to ${f.topCategory.name}, ${fmt(f.topCategory.totalMinor)} of the ${fmt(f.spentMinor)}${
				share >= 40 ? `, ${share}% of everything` : ''
			}.`
		);
	}

	// How it compares.
	if (s.momDeltaPct !== null && f.spentMinor > 0n) {
		const mag = Math.abs(s.momDeltaPct);
		if (mag < 5) {
			notes.push('Spending held roughly level with last month.');
		} else if (s.momDeltaMinor > 0n) {
			notes.push(`As a whole, that's ${fmt(s.momDeltaMinor)} more than last month, up ${mag}%.`);
		} else {
			notes.push(`As a whole, that's ${fmt(-s.momDeltaMinor)} less than last month, down ${mag}%.`);
		}
	}

	// How the plan held.
	if (s.budgetVarianceMinor !== null && f.budget) {
		if (s.budgetVarianceMinor >= 0n) {
			notes.push(
				`Your plan held: ${fmt(f.budget.actualMinor)} of a ${fmt(f.budget.limitMinor)} budget, ${fmt(s.budgetVarianceMinor)} to spare.`
			);
		} else {
			notes.push(
				`You went ${fmt(-s.budgetVarianceMinor)} past your ${fmt(f.budget.limitMinor)} budget.`
			);
		}
	}

	// What you kept.
	if (s.savingsRateBps !== null && f.savingsMinor > 0n) {
		const pct = Math.round(s.savingsRateBps / 100);
		if (pct >= 1) {
			notes.push(`You set aside ${pct}% of what came in.`);
		}
	}

	return { tone, lead, notes };
}
