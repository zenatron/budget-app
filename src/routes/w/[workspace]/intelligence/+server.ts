import { json } from '@sveltejs/kit';
import { eq, ilike, and } from 'drizzle-orm';

function jsonSafe(data: unknown) {
	return new Response(
		JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v)),
		{
			headers: { 'content-type': 'application/json' }
		}
	);
}
import { getDb } from '$lib/server/db';
import { purchase, workspaceMember, user as userTable } from '$lib/server/db/schema';
import { createBucket, listBuckets } from '$lib/server/repo/buckets';
import { Money } from '$lib/domain/money/money';
import { periodTotal, categoryBreakdown, memberBreakdown } from '$lib/server/repo/analytics';
import { incomeInPeriod } from '$lib/server/repo/income';
import { savingsInPeriod } from '$lib/server/repo/buckets';
import { monthPeriod, previousMonthPeriod, yearPeriod } from '$lib/domain/analytics/period';
import { systemClock } from '$lib/infra/time/system-clock';
import { calDateInZone } from '$lib/domain/time/zoned';
import { uuidv7 } from '$lib/infra/id/uuidv7';
import { parse, type TimePeriod } from '$lib/intelligence/parser';
import { formatPct } from '$lib/format';
import type { RequestHandler } from './$types';

function stringifyBigInts(obj: unknown): unknown {
	if (typeof obj === 'bigint') return obj.toString();
	if (Array.isArray(obj)) return obj.map(stringifyBigInts);
	if (obj && typeof obj === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(obj)) {
			out[k] = stringifyBigInts(v);
		}
		return out;
	}
	return obj;
}

function timeToPeriod(tp: TimePeriod) {
	const date = tp.month ? { y: tp.year, m: tp.month, d: 1 } : { y: tp.year, m: 7, d: 1 };
	return tp.type === 'year' ? yearPeriod(date) : monthPeriod(date);
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const { query } = await request.json();
	if (!query || typeof query !== 'string') {
		return jsonSafe({ intent: 'unknown', raw: '' });
	}

	const parsed = parse(query);
	const db = getDb();
	const scope = {
		workspaceId: locals.workspace!.id,
		viewerId: locals.member!.id,
		timezone: locals.workspace!.timezone
	};
	const currency = locals.workspace!.currency;
	const now = systemClock.now();
	const today = calDateInZone(now, scope.timezone);

	if (parsed.intent === 'spending_query') {
		const period = timeToPeriod(parsed.period);
		const prevPeriod =
			parsed.period.type === 'year'
				? (() => {
						const d = parsed.period.month
							? { y: parsed.period.year, m: parsed.period.month, d: 1 }
							: { y: parsed.period.year, m: 7, d: 1 };
						return previousMonthPeriod(d);
					})()
				: (() => {
						const d = parsed.period.month
							? { y: parsed.period.year, m: parsed.period.month, d: 1 }
							: { y: parsed.period.year, m: 7, d: 1 };
						return previousMonthPeriod(d);
					})();

		const total = await periodTotal(db, scope, period, now);
		const categories = await categoryBreakdown(db, scope, period, now);
		const members = await memberBreakdown(db, scope, period, now);
		const income = await incomeInPeriod(db, locals.workspace!.id, period, scope.timezone, today);
		let answer = '';
		let detail: unknown[] = [];
		let highlight: number | null = null;

		if (parsed.category) {
			const matched = categories.filter((c) =>
				c.name.toLowerCase().includes(parsed.category!.toLowerCase())
			);
			if (matched.length > 0) {
				const catTotal = matched.reduce((s, c) => s + c.totalMinor, 0n);
				const pct = total > 0n ? Number((catTotal * 1000n) / total) / 10 : 0;
				answer = `${Money.of(catTotal, currency).format()} spent on ${matched.map((c) => c.name).join(', ')} in ${parsed.period.label}`;
				detail = matched.map((c) => ({ label: c.name, amountMinor: c.totalMinor }));
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
			detail = categories.slice(0, 5).map((c) => ({ label: c.name, amountMinor: c.totalMinor }));
		}

		return jsonSafe({ intent: parsed.intent, answer, detail, highlight });
	}

	if (parsed.intent === 'net_position') {
		const period = timeToPeriod(parsed.period);
		const total = await periodTotal(db, scope, period, now);
		const income = await incomeInPeriod(db, locals.workspace!.id, period, scope.timezone, today);
		const savings = await savingsInPeriod(db, locals.workspace!.id, period, scope.timezone);
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

	if (parsed.intent === 'create_bucket') {
		try {
			const amount = Money.fromDecimal(String(parsed.amount), currency);
			if (!amount.isPositive) {
				return jsonSafe({ intent: parsed.intent, answer: 'Amount must be positive' });
			}
			await createBucket(
				getDb(),
				{ clock: systemClock, ids: uuidv7 },
				{
					workspaceId: locals.workspace!.id,
					memberId: locals.member!.id,
					name: parsed.name,
					monthlyAmountMinor: amount.minor,
					currency,
					dayOfMonth: parsed.dayOfMonth
				}
			);
			return jsonSafe({
				intent: parsed.intent,
				answer: `Bucket "${parsed.name}" created — ${amount.format()}/mo on day ${parsed.dayOfMonth}`
			});
		} catch (e) {
			return jsonSafe({
				intent: parsed.intent,
				answer: `Couldn't create bucket: ${(e as Error).message}`
			});
		}
	}

	if (parsed.intent === 'navigate') {
		return jsonSafe({
			intent: parsed.intent,
			target: parsed.target,
			answer: `Opening ${parsed.target}...`
		});
	}

	return jsonSafe({
		intent: 'unknown',
		raw: query,
		answer:
			'I couldn\'t understand that. Try a question like "how much did I spend on groceries last month?" or a command like "create a travel bucket of 500/mo".'
	});
};
