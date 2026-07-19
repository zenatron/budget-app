/**
 * Rule-based natural language parser for budget queries and commands.
 * No AI — just token matching, entity extraction, and pattern routing.
 */

export interface SpendingQuery {
	intent: 'spending_query';
	category?: string;
	member?: string;
	period: TimePeriod;
}

export interface NetQuery {
	intent: 'net_position';
	period: TimePeriod;
}

export interface CreateBucketCommand {
	intent: 'create_bucket';
	name: string;
	amount: number;
	dayOfMonth: number;
}

export interface NavigateCommand {
	intent: 'navigate';
	target: 'analytics' | 'buckets' | 'recurring' | 'income' | 'purchases' | 'settings';
}

export interface UnknownResult {
	intent: 'unknown';
	raw: string;
}

export type ParsedIntent =
	SpendingQuery | NetQuery | CreateBucketCommand | NavigateCommand | UnknownResult;

export interface TimePeriod {
	type: 'month' | 'year';
	month?: number;
	year: number;
	label: string;
}

const MONTHS: Record<string, number> = {
	january: 1,
	february: 2,
	march: 3,
	april: 4,
	may: 5,
	june: 6,
	july: 7,
	august: 8,
	september: 9,
	october: 10,
	november: 11,
	december: 12,
	jan: 1,
	feb: 2,
	mar: 3,
	apr: 4,
	jun: 6,
	jul: 7,
	aug: 8,
	sep: 9,
	oct: 10,
	nov: 11,
	dec: 12
};

function resolvePeriod(input: string, now: Date): TimePeriod {
	const currentYear = now.getFullYear();
	const currentMonth = now.getMonth() + 1;

	const lower = input.toLowerCase().trim();

	// "last june", "last december"
	const lastMatch = lower.match(/\blast\s+(\w+)\b/);
	if (lastMatch && MONTHS[lastMatch[1]]) {
		const m = MONTHS[lastMatch[1]];
		const y = currentMonth <= m ? currentYear - 1 : currentYear;
		return { type: 'month', month: m, year: y, label: `${lastMatch[1]} ${y}` };
	}

	// "june 2024", "march 2025"
	const namedMatch = lower.match(/\b(\w+)\s+(\d{4})\b/);
	if (namedMatch && MONTHS[namedMatch[1]]) {
		const m = MONTHS[namedMatch[1]];
		const y = parseInt(namedMatch[2]);
		return { type: 'month', month: m, year: y, label: `${namedMatch[1]} ${y}` };
	}

	// "in june", "during july", "for august" — bare month reference
	const inMonthMatch = lower.match(/\b(?:in|during|for|this\s+past)\s+(\w+)\b/);
	if (inMonthMatch && MONTHS[inMonthMatch[1]]) {
		const m = MONTHS[inMonthMatch[1]];
		const y = m <= currentMonth ? currentYear : currentYear - 1;
		return { type: 'month', month: m, year: y, label: `${inMonthMatch[1]} ${y}` };
	}

	// Standalone month name: "june", "december"
	const bareMonthMatch = lower.match(
		/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/
	);
	if (bareMonthMatch && MONTHS[bareMonthMatch[1]]) {
		const m = MONTHS[bareMonthMatch[1]];
		const y = m <= currentMonth ? currentYear : currentYear - 1;
		return { type: 'month', month: m, year: y, label: `${bareMonthMatch[1]} ${y}` };
	}

	// "in 2024", "year 2024"
	const yearMatch = lower.match(/\b(?:in\s+)?(\d{4})\b/);
	if (yearMatch) {
		const y = parseInt(yearMatch[1]);
		return { type: 'year', year: y, label: `${y}` };
	}

	// "this month"
	if (/\bthis\s+month\b/.test(lower)) {
		return { type: 'month', month: currentMonth, year: currentYear, label: 'this month' };
	}

	// "last month"
	if (/\blast\s+month\b/.test(lower)) {
		const m = currentMonth === 1 ? 12 : currentMonth - 1;
		const y = currentMonth === 1 ? currentYear - 1 : currentYear;
		return { type: 'month', month: m, year: y, label: 'last month' };
	}

	// "this year"
	if (/\bthis\s+year\b/.test(lower)) {
		return { type: 'year', year: currentYear, label: `${currentYear}` };
	}

	// "last year"
	if (/\blast\s+year\b/.test(lower)) {
		return { type: 'year', year: currentYear - 1, label: `${currentYear - 1}` };
	}

	// Default: this month
	return { type: 'month', month: currentMonth, year: currentYear, label: 'this month' };
}

function extractAmount(lower: string): { amount: number; monthly: boolean } | null {
	// "$500", "500/mo", "500 per month", "$500 monthly"
	const amtMatch = lower.match(/\$?(\d+(?:\.\d{1,2})?)\s*(?:\/mo|per\s+month|monthly|a\s+month)/);
	if (amtMatch) {
		return { amount: parseFloat(amtMatch[1]), monthly: true };
	}
	const plainMatch = lower.match(/\$?(\d+(?:\.\d{1,2})?)/);
	if (plainMatch) {
		return { amount: parseFloat(plainMatch[1]), monthly: false };
	}
	return null;
}

function extractDayOfMonth(lower: string): number {
	// "on the 1st", "every 15th", "day 5", "first day", "last day"
	if (/\blast\s+day\b/.test(lower)) return -1;
	if (/\bfirst\s+day\b/.test(lower)) return 1;

	// Anchored first. The prefix used to be optional, which made this match the
	// first number anywhere in the string — always the amount ("500/mo on the
	// 15th" → 500 → out of range → silently the 1st).
	const anchored = lower.match(/\b(?:on\s+the|every|day)\s+(\d+)(?:st|nd|rd|th)?\b/);
	if (anchored) {
		const d = parseInt(anchored[1]);
		if (d >= 1 && d <= 28) return d;
	}

	// Bare ordinal ("the 15th"): only ordinals, so an amount can't be mistaken
	// for a day.
	const ordinal = lower.match(/\b(\d+)(?:st|nd|rd|th)\b/);
	if (ordinal) {
		const d = parseInt(ordinal[1]);
		if (d >= 1 && d <= 28) return d;
	}
	return 1;
}

const NAV_TARGETS: Record<string, NavigateCommand['target']> = {
	analytics: 'analytics',
	activity: 'analytics',
	chart: 'analytics',
	graph: 'analytics',
	stats: 'analytics',
	buckets: 'buckets',
	bucket: 'buckets',
	savings: 'buckets',
	recurring: 'recurring',
	subscriptions: 'recurring',
	bills: 'recurring',
	income: 'income',
	salary: 'income',
	purchases: 'purchases',
	wallet: 'purchases',
	spending: 'purchases',
	purchase: 'purchases',
	settings: 'settings',
	setting: 'settings'
};

/**
 * `now` is a parameter, not `new Date()` inside: every relative period ("last
 * month", "this year") is resolved against it, so tests can pin a date instead
 * of changing answers every month.
 */
export function parse(input: string, now: Date = new Date()): ParsedIntent {
	const lower = input.toLowerCase().trim();
	if (!lower) return { intent: 'unknown', raw: input };

	// Navigate: "show me analytics", "go to buckets", "open settings"
	const navMatch = lower.match(
		/\b(?:show\s+me\s+|go\s+to\s+|open\s+|take\s+me\s+to\s+|navigate\s+to\s+)\s*(\w+)/
	);
	if (navMatch && NAV_TARGETS[navMatch[1]]) {
		return { intent: 'navigate', target: NAV_TARGETS[navMatch[1]] };
	}
	if (NAV_TARGETS[lower]) {
		return { intent: 'navigate', target: NAV_TARGETS[lower] };
	}

	// Create bucket: "create a travel bucket of 500/mo on the 1st"
	if (
		/\b(?:create|add|make|new)\s+(?:a\s+|an\s+)?.*?(?:bucket|savings\s+bucket|virtual\s+account)/.test(
			lower
		)
	) {
		const amt = extractAmount(lower);
		if (amt && amt.monthly) {
			// Extract name: everything between "bucket" or "create" and "of"/"for"
			let name = '';
			const nameMatch = lower.match(
				/(?:create|add|make|new)\s+(?:a\s+)?(?:new\s+)?(?:bucket\s+)?(?:called\s+|named\s+|for\s+)?(.+?)\s+(?:of|for|at|with)\s/
			);
			if (nameMatch) {
				name = nameMatch[1].replace(/bucket|savings/gi, '').trim();
			}
			if (!name) {
				// Try: "create a name bucket of 500/mo"
				const altMatch = lower.match(/(?:create|add|make|new)\s+(?:a\s+)?(.+?)\s+bucket/);
				if (altMatch) name = altMatch[1].trim();
			}
			const dayOfMonth = extractDayOfMonth(lower);
			return {
				intent: 'create_bucket',
				name: name || 'New bucket',
				amount: amt.amount,
				dayOfMonth
			};
		}
		return { intent: 'unknown', raw: input };
	}

	// Net position / savings rate: "what's my net", "savings rate", "how much am i saving"
	if (
		/\b(?:net\s+position|savings?\s+rate|how\s+much\s+am\s+i\s+saving|what(?:'s| is) my net|net worth)\b/.test(
			lower
		)
	) {
		const period = resolvePeriod(lower, now);
		return { intent: 'net_position', period };
	}

	// Spending query: "how much did I spend on X", "what did I spend on Y last month"
	if (/\b(?:how\s+much|what|show\s+me|spend(?:ing)?|spent)\b/.test(lower)) {
		const period = resolvePeriod(lower, now);

		// Check for member: "how much did alice spend"
		const memberMatch = lower.match(
			/(?:how\s+much\s+did|what\s+did|spend(?:ing)?\s+by|spent\s+by)\s+(\w+)\b/
		);
		if (memberMatch && !['i', 'me', 'my', 'we', 'us'].includes(memberMatch[1])) {
			return { intent: 'spending_query', member: memberMatch[1], period };
		}

		// Check for category: extract words between "on" and time reference
		let category: string | undefined;

		// "spend on entertainment" or "spent on groceries"
		const onMatch = lower.match(/\b(?:on)\s+(.+?)(?:\s+(?:in|last|this|for|during|at)\b|\s*$)/);
		if (onMatch) {
			const raw = onMatch[1].replace(/\?|how\s+much|what|show\s+me|the\b/g, '').trim();
			if (raw && !/\b(?:i|me|my|we|us|all|everything)\b/.test(raw)) {
				category = raw;
			}
		}

		// "how much did i spend" without specific category → total spending
		if (!category && /\b(?:how\s+much\s+did)\b/.test(lower)) {
			return { intent: 'spending_query', period };
		}

		return { intent: 'spending_query', category, period };
	}

	return { intent: 'unknown', raw: input };
}

export const EXAMPLE_PROMPTS = [
	'how much did I spend on groceries last month?',
	'what did alice spend this month?',
	'create a travel bucket of 500/mo on the 15th',
	"what's my net position?",
	'show me activity',
	'how much did I spend in June?'
];
