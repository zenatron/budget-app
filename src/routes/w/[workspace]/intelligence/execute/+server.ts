import { error, json } from '@sveltejs/kit';
import * as v from 'valibot';
import { getDb } from '$lib/server/db';
import { getEnv } from '$lib/server/env';
import { createBucket } from '$lib/server/repo/buckets';
import { addIncome } from '$lib/server/repo/income';
import { Money, InvalidMoneyError } from '$lib/domain/money/money';
import { nextAccrualDate } from '$lib/application/buckets';
import { formatRRule } from '$lib/domain/recurrence/rrule';
import { calDateInZone, zonedTimeToUtc } from '$lib/domain/time/zoned';
import { systemClock } from '$lib/infra/time/system-clock';
import { uuidv7 } from '$lib/infra/id/uuidv7';
import type { RequestHandler } from './$types';

const deps = { clock: systemClock, ids: uuidv7 };

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

function safeName(raw: string, maxLen = 120): string | null {
	const cleaned = stripControlChars(raw).replace(/\s+/g, ' ').trim();
	if (!cleaned) return null;
	return cleaned.length > maxLen ? cleaned.slice(0, maxLen).trim() : cleaned;
}

function normalizeDay(d: number): number {
	if (d === -1) return 28;
	return Math.min(Math.max(d, 1), 28);
}

const ProposalSchema = v.variant('intent', [
	v.object({
		intent: v.literal('create_bucket'),
		name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
		amount: v.number(),
		amountMinor: v.optional(v.string()),
		dayOfMonth: v.number(),
		currency: v.string()
	}),
	v.object({
		intent: v.literal('create_income'),
		source: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
		amount: v.number(),
		amountMinor: v.optional(v.string()),
		monthly: v.boolean(),
		dayOfMonth: v.number(),
		currency: v.string()
	}),
	v.object({
		intent: v.literal('navigate'),
		target: v.picklist(['analytics', 'buckets', 'recurring', 'income', 'purchases', 'settings']),
		label: v.optional(v.string())
	})
]);

const BodySchema = v.object({
	proposal: ProposalSchema
});

export const POST: RequestHandler = async ({ locals, request }) => {
	assertSameOrigin(request);

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Malformed request body');
	}

	const parsed = v.safeParse(BodySchema, body);
	if (!parsed.success) {
		return json({ intent: 'error', answer: 'That proposal is not valid.' });
	}

	const proposal = parsed.output.proposal;
	const ws = locals.workspace!;
	const currency = ws.currency;
	const timezone = ws.timezone;
	const now = systemClock.now();
	const today = calDateInZone(now, timezone);

	if (proposal.intent === 'navigate') {
		return json({
			intent: 'navigate',
			target: proposal.target,
			answer: `Opening ${proposal.target}…`
		});
	}

	try {
		const amount = Money.fromDecimal(String(proposal.amount), currency);
		if (!amount.isPositive) {
			return json({ intent: proposal.intent, answer: 'Amount must be positive.' });
		}
		const day = normalizeDay(proposal.dayOfMonth);

		if (proposal.intent === 'create_bucket') {
			const name = safeName(proposal.name);
			if (!name) {
				return json({ intent: 'create_bucket', answer: 'Bucket needs a name.' });
			}
			const nextAccrualAt = nextAccrualDate(today, day, timezone);
			await createBucket(getDb(), deps, {
				workspaceId: ws.id,
				memberId: locals.member!.id,
				name,
				monthlyAmountMinor: amount.minor,
				currency,
				dayOfMonth: day,
				nextAccrualAt
			});
			return json({
				intent: 'create_bucket',
				answer: `Bucket “${name}” created — ${amount.format()}/mo on day ${day}.`,
				target: 'buckets'
			});
		}

		if (proposal.intent === 'create_income') {
			const source = safeName(proposal.source);
			if (!source) {
				return json({ intent: 'create_income', answer: 'Income needs a source.' });
			}
			const start = proposal.monthly
				? { y: today.y, m: today.m, d: Math.min(day, 28) }
				: { y: today.y, m: today.m, d: today.d };
			const rrule = proposal.monthly
				? formatRRule({ start, freq: 'monthly', interval: 1, byMonthDay: start.d })
				: null;
			await addIncome(getDb(), deps, {
				workspaceId: ws.id,
				memberId: locals.member!.id,
				source,
				amountMinor: amount.minor,
				currency,
				receivedAt: zonedTimeToUtc(start, 9, 0, timezone),
				rrule,
				note: null
			});
			return json({
				intent: 'create_income',
				answer: proposal.monthly
					? `Income “${source}” added — ${amount.format()} monthly on day ${start.d}.`
					: `Income “${source}” added — ${amount.format()}.`,
				target: 'income'
			});
		}
	} catch (e) {
		if (e instanceof InvalidMoneyError) {
			return json({ intent: proposal.intent, answer: e.message });
		}
		throw e;
	}

	return json({ intent: 'error', answer: 'That action could not be completed.' });
};
