/**
 * Does the briefing actually contain what this question is asking for?
 *
 * Harmony's prompt tells the model to say so plainly when the briefing falls
 * short. That instruction is real and it stays, but it is the wrong mechanism to
 * rely on: it asks a small local model to volunteer that it cannot help, against
 * every pull it has toward being useful. The failure mode is not a refusal, it
 * is a confident sentence built out of the nearest number to hand.
 *
 * So the decision moves here. We assemble the briefing, so we know exactly what
 * is in it — and its window is narrow and fixed: this month and last month, as
 * totals and breakdowns. A question that names March, or 2024, or next quarter
 * cannot be answered from that, and no amount of prompting changes the fact. We
 * can settle that before the model is ever called, and give the same answer
 * whether the assist is on, off, or timing out.
 *
 * Deliberately limited to *time*, because time is where the briefing's edges are
 * genuinely knowable. Everything else still goes to the model with the prompt
 * rules as its guardrail — guessing at topic scope with a keyword list would
 * refuse good questions, which is a worse failure than a hedge.
 *
 * Pure. Only ever consulted for text the deterministic parser did not recognise.
 */

export interface BriefingScope {
	/** The months the briefing carries figures for. */
	months: { y: number; m: number }[];
	/** The current month, for resolving a bare month name to a year. */
	today: { y: number; m: number };
}

export interface OutOfScope {
	/** The words in the question that put it outside the briefing. */
	mention: string;
	/** Where the person should look instead. */
	suggest: 'analytics' | 'ledger';
}

const MONTHS: Record<string, number> = {
	january: 1,
	jan: 1,
	february: 2,
	feb: 2,
	march: 3,
	mar: 3,
	april: 4,
	apr: 4,
	may: 5,
	june: 6,
	jun: 6,
	july: 7,
	jul: 7,
	august: 8,
	aug: 8,
	september: 9,
	sep: 9,
	sept: 9,
	october: 10,
	oct: 10,
	november: 11,
	nov: 11,
	december: 12,
	dec: 12
};

/**
 * Windows the briefing has no figure for at any granularity. A day and a week
 * are as unanswerable as a decade: the briefing totals whole months.
 */
const UNCOVERED_WINDOWS: { re: RegExp; suggest: OutOfScope['suggest'] }[] = [
	{ re: /\b(?:last|past|previous)\s+year\b/, suggest: 'analytics' },
	{ re: /\bthis\s+year\b/, suggest: 'analytics' },
	{ re: /\byear[\s-]to[\s-]date\b|\bytd\b/, suggest: 'analytics' },
	{ re: /\ball[\s-]time\b|\bever\b|\bsince I (?:joined|started)\b/, suggest: 'analytics' },
	{ re: /\blast\s+(?:\d+|few|several)\s+(?:months|weeks|days|years)\b/, suggest: 'analytics' },
	{ re: /\b(?:last|this|past)\s+week\b/, suggest: 'ledger' },
	{ re: /\b(?:yesterday|today)\b/, suggest: 'ledger' },
	{ re: /\b(?:next)\s+(?:month|year|week|quarter)\b/, suggest: 'analytics' },
	{ re: /\b(?:q1|q2|q3|q4|quarter)\b/, suggest: 'analytics' }
];

function covers(scope: BriefingScope, y: number, m: number): boolean {
	return scope.months.some((p) => p.y === y && p.m === m);
}

/**
 * The month a question names, resolved the way the palette's own parser
 * resolves one: a bare month that hasn't happened yet this year means last
 * year's. Null when no month is named. Exposed so the ask route can build the
 * briefing *around* the named month — the wider-window half of the bargain, of
 * which the coverage check here is the other.
 */
export function mentionedMonthPeriod(
	query: string,
	today: { y: number; m: number }
): { y: number; m: number; mention: string } | null {
	const q = query.toLowerCase();
	const named = new RegExp(`\\b(${Object.keys(MONTHS).join('|')})\\b`).exec(q);
	if (!named) return null;
	const month = MONTHS[named[1]];
	// An explicit year alongside it wins over the inferred one.
	const withYear = new RegExp(`\\b${named[1]}\\s+(\\d{4})\\b`).exec(q);
	const year = withYear ? Number(withYear[1]) : month <= today.m ? today.y : today.y - 1;
	return { y: year, m: month, mention: withYear ? withYear[0] : named[0] };
}

/**
 * Returns what puts the question outside the briefing, or null when nothing does.
 * Null is not a promise that the briefing can answer it — only that time isn't
 * the reason it can't.
 */
export function outOfBriefingScope(query: string, scope: BriefingScope): OutOfScope | null {
	const q = query.toLowerCase();

	for (const w of UNCOVERED_WINDOWS) {
		const m = w.re.exec(q);
		if (m) return { mention: m[0], suggest: w.suggest };
	}

	// A named month, resolved the same way as above, checked for coverage.
	const named = mentionedMonthPeriod(q, scope.today);
	if (named && !covers(scope, named.y, named.m)) {
		return { mention: named.mention, suggest: 'analytics' };
	}

	// A bare year is always an annual aggregate, which the briefing never holds.
	const year = /\b(19|20)\d{2}\b/.exec(q);
	if (year) return { mention: year[0], suggest: 'analytics' };

	return null;
}
