import { error, fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import * as v from 'valibot';
import { getDb } from '$lib/server/db';
import { workspaceMember } from '$lib/db/schema';
import { createInvite, listOpenInvites } from '$lib/server/repo/invites';
import { listMembers } from '$lib/repo/workspaces';
import {
	BUCKET_CHARGE_RULES,
	InvalidPolicyError,
	strandedByRemoving,
	validatePolicy,
	type ApprovalPolicy
} from '$lib/domain/approval/policy';
import { Money, InvalidMoneyError } from '$lib/domain/money/money';
import {
	describeRecurrence,
	formatRRule,
	parseRRule,
	RecurrenceError
} from '$lib/domain/recurrence/rrule';
import { recurrenceFromFields } from '$lib/domain/recurrence/from-fields';
import { calDateInZone } from '$lib/domain/time/zoned';
import { firstAccrualAt } from '$lib/application/buckets';
import { createBucket, listBuckets, updateBucket } from '$lib/repo/buckets';
import { uuidv7 } from '$lib/infra/id/uuidv7';
import { systemClock } from '$lib/infra/time/system-clock';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	// Re-run this workspace-scoped load when the workspace in the URL changes;
	// a locals-only load declares no such dependency. See +layout.server.ts.
	void params.workspace;
	const db = getDb();
	const now = systemClock.now();
	const members = await listMembers(db, locals.workspace!.id);
	const isOwner = locals.member!.role === 'owner';
	// Invites live here rather than on the settings root: creating a code is
	// how a member gets added, so it belongs with the people it adds.
	const invites = isOwner ? await listOpenInvites(db, locals.workspace!.id, now) : [];
	// Each member's allowance pot, if they have one: the active bucket they own
	// that nobody else can charge to. The editor reads back what is already set
	// rather than presenting an empty form over a live allowance.
	const buckets = await listBuckets(db, locals.workspace!.id);
	const allowanceOf = new Map(
		buckets
			.filter((b) => b.bucket.chargeMemberIds !== null && b.bucket.status === 'active')
			.map((b) => [
				b.bucket.memberId,
				{
					name: b.bucket.name,
					amountMinor: b.bucket.amountMinor,
					balanceMinor: b.balanceMinor,
					cadence: describeSchedule(b.bucket.rrule),
					...readSchedule(b.bucket.rrule)
				}
			])
	);

	return {
		isOwner,
		viewerMemberId: locals.member!.id,
		// So "inherit" can name what it defers to instead of being a dead end.
		workspaceSkipsBucketCharges: locals.workspace!.bucketChargesSkipApproval,
		members: members.map((m) => ({
			id: m.member.id,
			displayName: m.user.displayName,
			role: m.member.role,
			status: m.member.status,
			policy: m.member.approvalPolicy as ApprovalPolicy,
			allowance: allowanceOf.get(m.member.id) ?? null
		})),
		invites: invites.map((i) => ({ code: i.code, expiresAt: i.expiresAt.toISOString() }))
	};
};

const PolicySchema = v.object({
	memberId: v.pipe(v.string(), v.nonEmpty()),
	mode: v.picklist(['none', 'threshold', 'always']),
	threshold: v.optional(v.string()),
	bucketCharges: v.optional(v.picklist(BUCKET_CHARGE_RULES), 'inherit'),
	bucketScope: v.optional(v.picklist(['any', 'own']), 'any'),
	routingMode: v.optional(v.picklist(['any_of', 'specific']), 'any_of')
});

const AllowanceSchema = v.object({
	memberId: v.pipe(v.string(), v.nonEmpty()),
	amount: v.pipe(v.string(), v.trim(), v.minLength(1, 'How much?')),
	freq: v.picklist(['daily', 'weekly', 'monthly', 'yearly']),
	interval: v.pipe(
		v.string(),
		v.transform(Number),
		v.integer('Interval must be a whole number'),
		v.minValue(1),
		v.maxValue(52)
	),
	monthDay: v.optional(v.string()),
	startDate: v.pipe(v.string(), v.regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a start date'))
});

/** The rule in words, for the one-line summary beside a member's name. */
function describeSchedule(rrule: string): string {
	try {
		return describeRecurrence(parseRRule(rrule));
	} catch {
		return 'on a schedule';
	}
}

/**
 * An accrual rule read back as the picker's own fields.
 *
 * The allowance form used to offer three fixed cadences, which is a fine
 * starting point and a poor ceiling: an allowance that lands every other
 * Friday, or on the 15th, or twice a week, are all ordinary asks that it
 * could not express. It now uses the same recurrence picker the Buckets and
 * Plan pages use, so anything the app can schedule, an allowance can be.
 *
 * A rule that fails to parse reads back as a plain monthly one, so the form
 * always has legal values to show and saving is what changes the schedule.
 */
function readSchedule(rrule: string): {
	freq: string;
	interval: number;
	monthDay: string;
	startDate: string;
	weekDays: number[];
} {
	try {
		const rec = parseRRule(rrule);
		const pad = (n: number) => String(n).padStart(2, '0');
		return {
			freq: rec.freq,
			interval: rec.interval,
			monthDay: String(rec.byMonthDay ?? rec.start.d),
			startDate: `${rec.start.y}-${pad(rec.start.m)}-${pad(rec.start.d)}`,
			weekDays: rec.byDay ?? []
		};
	} catch {
		return { freq: 'monthly', interval: 1, monthDay: '1', startDate: '', weekDays: [] };
	}
}

export const actions: Actions = {
	invite: async ({ locals }) => {
		if (locals.member!.role !== 'owner') error(403, 'Only the owner can create invites');
		await createInvite(
			getDb(),
			{ clock: systemClock, ids: uuidv7 },
			{
				workspaceId: locals.workspace!.id,
				createdByMemberId: locals.member!.id,
				ttlDays: locals.workspace!.inviteTtlDays
			}
		);
		return { ok: true };
	},

	/**
	 * Promote a member to owner, or step an owner back down.
	 *
	 * Ownership used to be fixed at creation — the person who made the workspace
	 * was the only one who could ever change a setting, a budget or a policy, and
	 * there was no way to hand that over. Losing that account left the workspace
	 * permanently unadministrable.
	 *
	 * There is no separate "transfer" action because it would be this one twice:
	 * promote whoever is taking over, then step yourself down. Allowing several
	 * owners at once is what makes the handover safe — at no point is there
	 * nobody in charge.
	 */
	setMemberRole: async ({ locals, request }) => {
		if (locals.member!.role !== 'owner') error(403, 'Only an owner can change roles');
		const form = await request.formData();
		const memberId = String(form.get('memberId') ?? '');
		const makeOwner = form.get('owner') === 'true';

		const db = getDb();
		const members = await listMembers(db, locals.workspace!.id);
		const target = members.find((m) => m.member.id === memberId);
		if (!target) return fail(400, { error: 'Unknown member' });

		// A disabled member has no access, so making them an owner would grant
		// authority to someone who cannot use it — restore them first.
		if (target.member.status !== 'active') {
			return fail(400, { error: 'Restore this member before changing their role' });
		}

		if (!makeOwner) {
			const otherActiveOwners = members.filter(
				(m) => m.member.id !== memberId && m.member.role === 'owner' && m.member.status === 'active'
			);
			if (otherActiveOwners.length === 0) {
				return fail(400, {
					error: 'Someone has to own this workspace. Make another member an owner first.'
				});
			}
		}

		await db
			.update(workspaceMember)
			.set({ role: makeOwner ? 'owner' : 'member' })
			.where(
				and(eq(workspaceMember.id, memberId), eq(workspaceMember.workspaceId, locals.workspace!.id))
			);
		return { ok: true };
	},

	/**
	 * Disable or re-enable a member.
	 *
	 * Disabling revokes access outright — findWorkspaceForUser and the workspace
	 * switcher both already join on status='active', so the status *is* the gate.
	 * Their history stays: past purchases are a record of what happened, not
	 * configuration, and deleting them would silently rewrite everyone's totals.
	 */
	setMemberStatus: async ({ locals, request }) => {
		if (locals.member!.role !== 'owner') error(403, 'Only the owner can disable members');
		const form = await request.formData();
		const memberId = String(form.get('memberId') ?? '');
		const disable = form.get('disabled') === 'true';

		const db = getDb();
		const members = await listMembers(db, locals.workspace!.id);
		const target = members.find((m) => m.member.id === memberId);
		if (!target) return fail(400, { error: 'Unknown member' });

		if (disable) {
			// Locking yourself out is never what you meant, and with no ownership
			// transfer there would be no way back in.
			if (memberId === locals.member!.id) {
				return fail(400, { error: 'You cannot disable yourself' });
			}
			// The last owner holds the only keys to settings, budgets and invites.
			const otherActiveOwners = members.filter(
				(m) => m.member.id !== memberId && m.member.role === 'owner' && m.member.status === 'active'
			);
			if (target.member.role === 'owner' && otherActiveOwners.length === 0) {
				return fail(400, { error: 'That is the only owner. The workspace would be unmanageable.' });
			}

			const stranded = strandedByRemoving(
				members.map((m) => ({
					id: m.member.id,
					policy: m.member.approvalPolicy as ApprovalPolicy,
					status: m.member.status
				})),
				memberId
			);
			if (stranded.length > 0) {
				const names = stranded
					.map((id) => members.find((m) => m.member.id === id)?.user.displayName ?? 'someone')
					.join(' and ');
				return fail(400, {
					error: `${target.user.displayName} is the only approver for ${names}. Name someone else first.`
				});
			}
		}

		await db
			.update(workspaceMember)
			.set({ status: disable ? 'disabled' : 'active' })
			.where(
				and(eq(workspaceMember.id, memberId), eq(workspaceMember.workspaceId, locals.workspace!.id))
			);
		return { ok: true };
	},

	/**
	 * Set someone up with an allowance, in one action.
	 *
	 * An allowance is not a new kind of thing in this app. It is three settings
	 * that already exist, pointed at each other: a bucket only its owner can
	 * charge to, an accrual rule that tops it up, and a policy that says "ask me
	 * for anything, except what comes out of your own bucket, unless it would
	 * overdraw it." Assembled by hand that is four screens and an easy mistake,
	 * so it is offered whole here, beside the policy it composes.
	 *
	 * Run again on someone who already has one, it moves the amount and the
	 * cadence rather than handing them a second pot.
	 */
	allowance: async ({ locals, request }) => {
		if (locals.member!.role !== 'owner') error(403, 'Only the owner can set up an allowance');
		const form = await request.formData();
		const parsed = v.safeParse(AllowanceSchema, Object.fromEntries(form));
		if (!parsed.success) return fail(400, { error: parsed.issues[0].message });
		const f = parsed.output;

		const db = getDb();
		const ws = locals.workspace!;
		const members = await listMembers(db, ws.id);
		const target = members.find((m) => m.member.id === f.memberId);
		if (!target) return fail(400, { error: 'Unknown member' });
		if (target.member.status !== 'active') {
			return fail(400, { error: 'Restore this member before setting up an allowance' });
		}

		// Someone other than them has to be able to say yes, or every over-budget
		// purchase would stall with nobody able to decide it. Owners are who can.
		const approverIds = members
			.filter(
				(m) =>
					m.member.status === 'active' && m.member.role === 'owner' && m.member.id !== f.memberId
			)
			.map((m) => m.member.id);
		if (approverIds.length === 0) {
			return fail(400, {
				error: 'Somebody else has to be able to approve. Make another member an owner first.'
			});
		}

		let amount: Money;
		try {
			amount = Money.fromDecimal(f.amount, ws.currency);
		} catch (e) {
			if (e instanceof InvalidMoneyError) return fail(400, { error: e.message });
			throw e;
		}
		if (!amount.isPositive) return fail(400, { error: 'Amount must be positive' });

		const deps = { clock: systemClock, ids: uuidv7 };
		const today = calDateInZone(systemClock.now(), ws.timezone);
		let rrule: string;
		try {
			rrule = formatRRule(
				recurrenceFromFields({ ...f, weekDays: form.getAll('weekDay').map(Number) })
			);
		} catch (e) {
			if (e instanceof RecurrenceError) return fail(400, { error: e.message });
			throw e;
		}

		// Their existing allowance, if they have one: the active personal bucket
		// they own. Editing it keeps one pot with one history, so raising an
		// allowance doesn't strand the balance in the old one.
		const buckets = await listBuckets(db, ws.id);
		const existingBucket = buckets.find(
			(b) =>
				b.bucket.memberId === f.memberId &&
				b.bucket.chargeMemberIds?.length === 0 &&
				b.bucket.status === 'active'
		);
		const scope = { workspaceId: ws.id, memberId: f.memberId };
		if (existingBucket) {
			await updateBucket(db, scope, existingBucket.bucket.id, {
				amountMinor: amount.minor,
				rrule,
				nextAccrualAt: firstAccrualAt(rrule, today, ws.timezone)
			});
		} else {
			await createBucket(db, deps, {
				workspaceId: ws.id,
				memberId: f.memberId,
				name: `${target.user.displayName}'s allowance`,
				amountMinor: amount.minor,
				currency: ws.currency,
				rrule,
				// Empty list, so only they can spend from it. That is the allowance.
				chargeMemberIds: [],
				nextAccrualAt: firstAccrualAt(rrule, today, ws.timezone)
			});
		}

		const existingPolicy = target.member.approvalPolicy as ApprovalPolicy;
		const policy: ApprovalPolicy = {
			mode: 'always',
			category_overrides: existingPolicy.category_overrides,
			bucket_charges: 'skip',
			own_buckets_only: true,
			routing: { mode: 'any_of', approver_ids: approverIds }
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
			.where(and(eq(workspaceMember.id, f.memberId), eq(workspaceMember.workspaceId, ws.id)));
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
			bucketCharges: form.get('bucketCharges') ?? undefined,
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
			// 'inherit' is the absent state, so it is stored as absent rather than
			// as a literal — one representation for one meaning.
			...(f.bucketCharges !== 'inherit' ? { bucket_charges: f.bucketCharges } : {}),
			// Same reasoning: 'any' is the default, so it is stored as absent.
			...(f.bucketScope === 'own' ? { own_buckets_only: true } : {}),
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
