/**
 * "Help me find this" — the model's one job in reconciliation.
 *
 * A statement line the deterministic matcher wouldn't claim reads like
 * `SQ *COFFEE 0042 SEATTLE WA`. A person recognises it instantly. The matcher
 * can't: it compares amounts, dates and whole words, and a bank descriptor
 * shares no whole words with "flat white". That gap — between a descriptor and
 * the name a household actually used — is exactly the fuzzy, linguistic kind of
 * problem a language model is good at and a comparison is not.
 *
 * **Why this is a `pickChoice` and not a `cleanLabel`.** The obvious move is to
 * clean the descriptor into "Coffee" and search on that. It is the wrong shape.
 * Cleaning produces a string nobody validated, which then has to be matched
 * against purchases by some second mechanism — so a bad clean quietly becomes a
 * bad search, and the failure is invisible. Picking from the candidates we
 * already computed produces *an id we own*: `constrainToChoice` forces anything
 * invented, hedged, or ambiguous to null, so the worst case is no suggestion.
 * Same problem, strictly safer shape.
 *
 * **What this can and cannot cause.** It returns an id, and the caller uses it
 * to *preselect a row in a picker the person is already looking at*. Nothing is
 * written. The human still presses Link, which still goes through the existing
 * `?/link` action and `linkManually`, which re-reads the purchase through the
 * seal filter rather than trusting any id it was handed. The worst outcome of a
 * confidently wrong model here is a wrong row highlighted in a list — which the
 * person is reading anyway, because they opened the list to read it.
 *
 * With the assist off, or unreachable, or timing out, this returns null and the
 * picker opens exactly as it does today.
 */

import type { LlmAssist } from '$lib/ports/llm-assist';
import type { MatchCandidate } from '$lib/domain/reconcile/match';
import { Money } from '$lib/domain/money/money';

export interface SuggestMatchLine {
	/** The bank's own words, verbatim — the thing the model is decoding. */
	rawDescription: string;
	amountMinor: bigint;
	postedAt: Date;
	currency: string;
}

/**
 * How many candidates to offer. A long list is worse for a small model and
 * worse for the person reading the result: past a couple of dozen the picker
 * is a search problem, not a recognition problem, and search is already there.
 */
const MAX_CHOICES = 25;

/** Day-level ISO, which is the only precision a statement line really has. */
function isoDay(d: Date): string {
	return d.toISOString().slice(0, 10);
}

/**
 * Label a candidate with everything that distinguishes it from its neighbours:
 * what it was, where from, when, and how much. Two lunches on the same day are
 * told apart by amount; two identical amounts by merchant. If a pair is still
 * identical after all four, they are genuinely indistinguishable, and
 * `constrainToChoice` will refuse to pick between them — which is correct.
 */
function labelFor(c: MatchCandidate, currency: string): string {
	const amount = Money.of(c.amountMinor < 0n ? -c.amountMinor : c.amountMinor, currency).format();
	const where = c.merchantName ? ` at ${c.merchantName}` : '';
	return `${c.itemName}${where} · ${amount} on ${isoDay(c.completedAt)}`;
}

const EXAMPLES = [
	{ text: 'SQ *BLUE BOTTLE 0042 SEATTLE WA', answer: 'flat white at Blue Bottle' },
	{ text: 'TESCO STORES 3411', answer: 'weekly shop at Tesco' },
	// Abstaining is a real answer, not a failure. Small models need telling.
	{ text: 'ACH DEBIT 8891002', answer: 'NONE' }
];

/**
 * Ask the model which of `candidates` this line is, or null.
 *
 * The returned id is always one of the ids passed in — that is enforced twice,
 * by `constrainToChoice` inside the adapter and again here against the real
 * candidate list, the same belt-and-braces `suggestCategory` uses.
 */
export async function suggestMatch(
	assist: LlmAssist,
	line: SuggestMatchLine,
	candidates: MatchCandidate[]
): Promise<string | null> {
	if (!assist.available) return null;
	if (candidates.length === 0) return null;

	// Nearest in time first, then trimmed: a statement line is far more likely to
	// be a purchase from the same week than one from the edge of the window, and
	// something has to be dropped when a period holds hundreds.
	const posted = line.postedAt.getTime();
	const shortlist = [...candidates]
		.sort(
			(a, b) =>
				Math.abs(a.completedAt.getTime() - posted) - Math.abs(b.completedAt.getTime() - posted)
		)
		.slice(0, MAX_CHOICES);

	const byId = new Map(shortlist.map((c) => [c.id, c]));
	const choices = shortlist.map((c) => ({ id: c.id, label: labelFor(c, line.currency) }));
	const amount = Money.of(
		line.amountMinor < 0n ? -line.amountMinor : line.amountMinor,
		line.currency
	).format();

	const picked = await assist.pickChoice({
		instruction:
			'A bank statement line is written in the bank’s shorthand. Pick the recorded purchase it refers to. Answer NONE if none of them clearly match.',
		text: line.rawDescription,
		context: [
			{ label: 'Statement line', value: line.rawDescription },
			{ label: 'Amount', value: amount },
			{ label: 'Date', value: isoDay(line.postedAt) }
		],
		examples: EXAMPLES,
		choices
	});

	return picked && byId.has(picked) ? picked : null;
}
