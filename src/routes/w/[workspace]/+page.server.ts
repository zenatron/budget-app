import { error, fail } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '$lib/server/db';
import { purchase, workspaceMember } from '$lib/server/db/schema';
import { createInvite, listOpenInvites } from '$lib/server/repo/invites';
import { listMembers } from '$lib/server/repo/workspaces';
import { visibleTo } from '$lib/server/repo/purchases';
import {
	InvalidPolicyError,
	validatePolicy,
	type ApprovalPolicy
} from '$lib/domain/approval/policy';
import { Money, InvalidMoneyError } from '$lib/domain/money/money';
import { uuidv7 } from '$lib/infra/id/uuidv7';
import { systemClock } from '$lib/infra/time/system-clock';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const db = getDb();
	const now = systemClock.now();
	const members = await listMembers(db, locals.workspace!.id);
	const isOwner = locals.member!.role === 'owner';
	const invites = isOwner ? await listOpenInvites(db, locals.workspace!.id, now) : [];
	const [pendingRow] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(purchase)
		.where(
			and(
				eq(purchase.workspaceId, locals.workspace!.id),
				eq(purchase.state, 'pending_approval'),
				visibleTo(locals.member!.id, now)
			)
		);
	return {
		pendingCount: pendingRow.count,
		members: members.map((m) => ({
			id: m.member.id,
			displayName: m.user.displayName,
			role: m.member.role,
			status: m.member.status,
			policy: m.member.approvalPolicy as ApprovalPolicy
		})),
		invites: invites.map((i) => ({ code: i.code, expiresAt: i.expiresAt.toISOString() }))
	};
};

const PolicySchema = v.object({
	memberId: v.pipe(v.string(), v.nonEmpty()),
	mode: v.picklist(['none', 'threshold', 'always']),
	threshold: v.optional(v.string()),
	routingMode: v.optional(v.picklist(['any_of', 'specific']), 'any_of')
});

export const actions: Actions = {
	invite: async ({ locals }) => {
		if (locals.member!.role !== 'owner') error(403, 'Only the owner can create invites');
		await createInvite(
			getDb(),
			{ clock: systemClock, ids: uuidv7 },
			{ workspaceId: locals.workspace!.id, createdByMemberId: locals.member!.id }
		);
		return { ok: true };
	},

	policy: async ({ locals, request }) => {
		if (locals.member!.role !== 'owner') error(403, 'Only the owner can change policies');
		const form = await request.formData();
		const approverIds = form.getAll('approverIds').map(String);
		const parsed = v.safeParse(PolicySchema, {
			memberId: form.get('memberId'),
			mode: form.get('mode'),
			threshold: form.get('threshold') ?? undefined,
			routingMode: form.get('routingMode') ?? undefined
		});
		if (!parsed.success) return fail(400, { error: parsed.issues[0].message });
		const f = parsed.output;

		const db = getDb();
		const members = await listMembers(db, locals.workspace!.id);
		const target = members.find((m) => m.member.id === f.memberId);
		if (!target) return fail(400, { error: 'Unknown member' });

		let thresholdMinor: number | undefined;
		if (f.mode === 'threshold') {
			try {
				const money = Money.fromDecimal(f.threshold ?? '', locals.workspace!.currency);
				thresholdMinor = Number(money.minor);
			} catch (e) {
				if (e instanceof InvalidMoneyError) return fail(400, { error: e.message });
				throw e;
			}
		}

		const existing = target.member.approvalPolicy as ApprovalPolicy;
		const policy: ApprovalPolicy = {
			mode: f.mode,
			...(thresholdMinor !== undefined ? { threshold_minor: thresholdMinor } : {}),
			category_overrides: existing.category_overrides,
			routing: { mode: f.routingMode, approver_ids: approverIds }
		};
		const activeIds = members.filter((m) => m.member.status === 'active').map((m) => m.member.id);
		try {
			validatePolicy(policy, activeIds);
		} catch (e) {
			if (e instanceof InvalidPolicyError) return fail(400, { error: e.message });
			throw e;
		}
		await db
			.update(workspaceMember)
			.set({ approvalPolicy: policy })
			.where(
				and(
					eq(workspaceMember.id, f.memberId),
					eq(workspaceMember.workspaceId, locals.workspace!.id)
				)
			);
		return { ok: true };
	}
};
