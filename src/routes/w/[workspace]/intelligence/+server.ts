import { error } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { getEnv } from '$lib/server/env';
import { savingsInPeriod } from '$lib/server/repo/buckets';
import { Money } from '$lib/domain/money/money';
import { periodTotal, categoryBreakdown, memberBreakdown } from '$lib/server/repo/analytics';
import { incomeInPeriod } from '$lib/server/repo/income';
import { monthPeriod, yearPeriod } from '$lib/domain/analytics/period';
import { systemClock } from '$lib/infra/time/system-clock';
import { calDateInZone } from '$lib/domain/time/zoned';
import { parse, type ParsedIntent, type TimePeriod } from '$lib/intelligence/parser';
import { formatPct } from '$lib/format';
import { getLlmAssist } from '$lib/infra/llm';
import type { ParsedAction } from '$lib/ports/llm-assist';
import type { WorkspaceRow } from '$lib/server/repo/workspaces';
import type { RequestHandler } from './$types';

/** Amounts cross the wire as bigint minor units; JSON.stringify can't do those. */
function jsonSafe(data: unknown) {
	return new Response(
		JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
		{ headers: { 'content-type': 'application/json' } }
	);
}

function timeToPeriod(tp: TimePeriod) {
	const date = tp.month ? { y: tp.year, m: tp.month, d: 1 } : { y: tp.year, m: 7, d: 1 };
	return tp.type === 'year' ? yearPeriod(date) : monthPeriod(date);
}

// Standalone endpoint: SvelteKit's form-action CSRF check doesn't cover it, and
// this one both reads workspace data and can create buckets.
function assertSameOrigin(request: Request): void {
	const origin = request.headers.get('origin');
	const allowed = new URL(getEnv().PUBLIC_ORIGIN).origin;
	if (origin !== allowed && origin !== new URL(request.url).origin) {
		error(403, 'Cross-origin request rejected');
	}
}

function stripControlChars(s: string): string {
	return s
		.split('')
		.filter((c) => {
			const code = c.charCodeAt(0);
			return code > 0x1f && code !== 0x7f;
		})
		.join('');
}

/** Strip control characters, collapse whitespace, and cap length for a label. */
function safeName(raw: string, maxLen = 120): string | null {
	const cleaned = stripControlChars(raw).replace(/\s+/g, ' ').trim();
	if (!cleaned) return null;
	return cleaned.length > maxLen ? cleaned.slice(0, maxLen).trim() : cleaned;
}

/** -1 means "last day of the month"; otherwise clamp to 1-28. */
function normalizeDay(d: number): number {
	if (d === -1) return 28;
	return Math.min(Math.max(d, 1), 28);
}

function moneyFromNumber(amount: number, currency: string): Money | null {
	if (!Number.isFinite(amount) || amount <= 0) return null;
	try {
		return Money.fromDecimal(String(amount), currency);
	} catch {
		return null;
	}
}

/**
 * Build a response that asks the user to confirm before anything is written.
 * The LLM (or deterministic parser) only ever *prepares* an action here; it
 * never executes one.
 */
function buildActionResponse(
	action: ParsedAction,
	ws: WorkspaceRow,
	query: string
): { intent: string; answer: string; describe?: string; propose?: unknown } | null {
	const currency = ws.currency;

	if (action.intent === 'log_purchase') {
		return {
			intent: 'log_purchase',
			answer: 'I’ll open the add screen with what you said. You can edit before saving.',
			describe: query
		};
	}

	if (action.intent === 'navigate') {
		return {
			intent: 'navigate',
			answer: `Open ${action.target}`,
			propose: { intent: 'navigate', target: action.target, label: action.target }
		};
	}

	if (action.intent === 'create_bucket') {
		const name = safeName(action.name);
		const amount = moneyFromNumber(action.amount, currency);
		if (!name) {
			return { intent: 'create_bucket', answer: 'I need a name for the bucket.' };
		}
		if (!amount) {
			return { intent: 'create_bucket', answer: 'I need a positive amount for the bucket.' };
		}
		const day = normalizeDay(action.dayOfMonth);
		return {
			intent: 'propose',
			answer: `Create bucket “${name}” — ${amount.format()}/mo on day ${day}`,
			propose: {
				intent: 'create_bucket',
				name,
				amount: action.amount,
				amountMinor: amount.minor.toString(),
				dayOfMonth: day,
				currency
			}
		};
	}

	if (action.intent === 'create_income') {
		const source = safeName(action.source);
		const amount = moneyFromNumber(action.amount, currency);
		if (!source) {
			return { intent: 'create_income', answer: 'I need a source for the income.' };
		}
		if (!amount) {
			return { intent: 'create_income', answer: 'I need a positive amount for the income.' };
		}
		const day = normalizeDay(action.dayOfMonth);
		const cadence = action.monthly ? 'monthly' : 'once';
		return {
			intent: 'propose',
			answer: `Add income “${source}” — ${amount.format()} ${cadence}${action.monthly ? ` on day ${day}` : ''}`,
			propose: {
				intent: 'create_income',
				source,
				amount: action.amount,
				amountMinor: amount.minor.toString(),
				monthly: action.monthly,
				dayOfMonth: day,
				currency
			}
		};
	}

	return null;
}

/**
 * Convert the deterministic parser's output into the same closed action shape
 * the LLM uses, so both paths share the same proposal/confirmation flow.
 */
function deterministicAction(parsed: ParsedIntent): ParsedAction | null {
	switch (parsed.intent) {
		case 'create_bucket':
			return {
				intent: 'create_bucket',
				name: parsed.name,
				amount: parsed.amount,
				dayOfMonth: parsed.dayOfMonth
			};
		case 'create_income':
			return {
				intent: 'create_income',
				source: parsed.source,
				amount: parsed.amount,
				monthly: parsed.cadence === 'monthly',
				dayOfMonth: parsed.dayOfMonth
			};
		case 'navigate':
			return { intent: 'navigate', target: parsed.target };
		case 'log_purchase':
			return { intent: 'log_purchase' };
		default:
			return null;
	}
}

export const POST: RequestHandler = async ({ locals, request }) => {
	assertSameOrigin(request);

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Malformed request body');
	}

	const query = (body as { query?: unknown } | null)?.query;
	if (!query || typeof query !== 'string') {
		return jsonSafe({ intent: 'unknown', raw: '' });
	}

	const parsed = parse(query);
	const db = getDb();
	const ws = locals.workspace!;
	const scope = {
		workspaceId: ws.id,
		viewerId: locals.member!.id,
		timezone: ws.timezone
	};
	const currency = ws.currency;
	const now = systemClock.now();
	const today = calDateInZone(now, scope.timezone);

	// First, try the deterministic parser for anything it already understands.
	const action = deterministicAction(parsed);
	if (action) {
		const response = buildActionResponse(action, ws, query);
		if (response) return jsonSafe(response);
	}

	// If the deterministic parser is stumped and an LLM is configured, let the
	// model extract a safe, constructive action. It is still only preparing; the
	// response below always asks the user to confirm before writing.
	if (parsed.intent === 'unknown') {
		const assist = getLlmAssist({
			aiMode: ws.aiMode,
			aiEndpoint: ws.aiEndpoint,
			aiModel: ws.aiModel,
			aiApiKey: ws.aiApiKey
		});
		if (assist.available) {
			const guessed = await assist.parseCommand({ query });
			if (guessed && guessed.intent !== 'unknown') {
				const response = buildActionResponse(guessed, ws, query);
				if (response) return jsonSafe(response);
			}
		}
	}

	if (parsed.intent === 'spending_query') {
		const period = timeToPeriod(parsed.period);
		const total = await periodTotal(db, scope, period, now);
		const categories = await categoryBreakdown(db, scope, period, now);
		const members = await memberBreakdown(db, scope, period, now);
		const income = await incomeInPeriod(db, ws.id, period, scope.timezone, today);
		let answer: string;
		let detail: unknown[] = [];
		let highlight: number | null = null;

		if (parsed.category) {
			const matched = categories.filter((c) =>
				c.name.toLowerCase().includes(parsed.category!.toLowerCase())
			);
			if (matched.length > 0) {
				const catTotal = matched.reduce((s, c) => s + c.totalMinor, 0n);
				answer = `${Money.of(catTotal, currency).format()} spent on ${matched.map((c) => c.name).join(', ')} in ${parsed.period.label}`;
				detail = matched.map((c) => ({ label: c.name, amountMinor: c.totalMinor.toString() }));
				highlight = Number(catTotal);
			} else {
				answer = `No spending found for "${parsed.category}" in ${parsed.period.label}`;
			}
		} else if (parsed.member) {
			const matched = members.filter((m) =>
				m.name.toLowerCase().includes(parsed.member!.toLowerCase())
			);
			if (matched.length > 0) {
				const mTotal = matched.reduce((s, m) => s + m.totalMinor, 0n);
				answer = `${matched[0].name} spent ${Money.of(mTotal, currency).format()} in ${parsed.period.label}`;
				highlight = Number(mTotal);
			} else {
				answer = `No spending found for "${parsed.member}" in ${parsed.period.label}`;
			}
		} else {
			answer = `Total spending in ${parsed.period.label}: ${Money.of(total, currency).format()}`;
			if (income > 0n) {
				const pct = Number((total * 1000n) / income) / 10;
				answer += ` (${formatPct(pct)} of income)`;
			}
			detail = categories
				.slice(0, 5)
				.map((c) => ({ label: c.name, amountMinor: c.totalMinor.toString() }));
		}

		return jsonSafe({ intent: parsed.intent, answer, detail, highlight });
	}

	if (parsed.intent === 'net_position') {
		const period = timeToPeriod(parsed.period);
		const total = await periodTotal(db, scope, period, now);
		const income = await incomeInPeriod(db, ws.id, period, scope.timezone, today);
		const savings = await savingsInPeriod(db, ws.id, period, scope.timezone);
		const net = income - total - savings;
		const pct = income > 0n ? Number((net * 1000n) / income) / 10 : 0;

		let answer = `In ${parsed.period.label}: `;
		answer += `${Money.of(income, currency).format()} in, `;
		answer += `${Money.of(total, currency).format()} out`;
		if (savings > 0n) answer += `, ${Money.of(savings, currency).format()} saved`;
		answer += `. Net: ${Money.of(net, currency).format()}`;
		if (income > 0n) answer += ` (${formatPct(pct)} free)`;

		return jsonSafe({ intent: parsed.intent, answer });
	}

	if (parsed.intent === 'incomplete') {
		return jsonSafe({
			intent: parsed.intent,
			answer: `That needs ${parsed.missing.join(' and ')}.`
		});
	}

	return jsonSafe({
		intent: 'unknown',
		raw: query,
		answer:
			'I couldn\'t understand that. Try a question like "how much did I spend on groceries last month?" or a command like "create a travel bucket of 500/mo".'
	});
};
