import { sql } from 'drizzle-orm';
import {
	type AnyPgColumn,
	bigint,
	boolean,
	date,
	foreignKey,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	smallint,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';

// IDs are UUIDv7, generated in the application (IdGenerator port), never in the DB.
// Money is bigint minor units + ISO-4217 code. Timestamps are timestamptz (UTC);
// period bucketing happens in the workspace timezone, in domain/analytics only.

export const memberRole = pgEnum('workspace_member_role', ['owner', 'member']);
export const memberStatus = pgEnum('workspace_member_status', ['active', 'invited', 'disabled']);
export const purchaseState = pgEnum('purchase_state', [
	'draft',
	'pending_approval',
	'approved',
	'denied',
	'cancelled',
	'completed',
	'refunded',
	// "Sleep on it": a pending request paused until held_until, then resurfaced.
	'held'
]);
export const recurringStatus = pgEnum('recurring_rule_status', ['active', 'paused', 'ended']);
export const budgetPeriod = pgEnum('budget_period', ['month', 'week']);
export const bucketStatus = pgEnum('bucket_status', ['active', 'paused', 'archived']);
export const bucketTxnType = pgEnum('bucket_txn_type', ['accrual', 'withdrawal', 'adjustment']);

// "user" is a reserved word in SQL; app_user keeps raw analytics queries sane.
export const user = pgTable('app_user', {
	id: uuid('id').primaryKey(),
	oidcSubject: text('oidc_subject').notNull().unique(),
	email: text('email').notNull(),
	displayName: text('display_name').notNull(),
	avatarBlobId: text('avatar_blob_id'),
	isDeploymentAdmin: boolean('is_deployment_admin').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
	lastLoginAt: timestamp('last_login_at', { withTimezone: true })
});

export const workspace = pgTable('workspace', {
	id: uuid('id').primaryKey(),
	slug: text('slug').notNull().unique(),
	name: text('name').notNull(),
	ownerUserId: uuid('owner_user_id')
		.notNull()
		.references(() => user.id),
	currency: text('currency').notNull(),
	timezone: text('timezone').notNull(),
	weekStartDay: smallint('week_start_day').notNull().default(1),
	staleAfterHours: integer('stale_after_hours').notNull().default(48),
	reapprovalThresholdPct: integer('reapproval_threshold_pct').notNull().default(10),
	sealedPurchaseCapMinor: bigint('sealed_purchase_cap_minor', { mode: 'bigint' }),
	maxSealDays: integer('max_seal_days').notNull().default(90),
	accentColor: text('accent_color'),
	bucketChargesSkipApproval: boolean('bucket_charges_skip_approval').notNull().default(false),
	/** Alpha: read a bill PDF to prefill a purchase. Off until asked for. */
	billImportEnabled: boolean('bill_import_enabled').notNull().default(false),
	/** Alpha: the intelligence surface — the ask palette and periodic summaries.
	 *  One flag for the whole suite so it promotes out of alpha together. */
	intelligenceEnabled: boolean('intelligence_enabled').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull()
});

export const workspaceMember = pgTable(
	'workspace_member',
	{
		id: uuid('id').primaryKey(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id),
		userId: uuid('user_id')
			.notNull()
			.references(() => user.id),
		role: memberRole('role').notNull().default('member'),
		approvalPolicy: jsonb('approval_policy').notNull(),
		status: memberStatus('status').notNull().default('active'),
		/** Intelligence summary cadence for this member: 'off' | 'weekly' | 'monthly'.
		 *  Per-member because a summary is your own seal-filtered view. */
		summaryCadence: text('summary_cadence').notNull().default('off'),
		/** When their last summary was sent, so the sweep fires once per period and
		 *  can catch up after downtime. */
		summaryLastSentAt: timestamp('summary_last_sent_at', { withTimezone: true }),
		joinedAt: timestamp('joined_at', { withTimezone: true }).notNull()
	},
	(t) => [uniqueIndex('workspace_member_workspace_user_uq').on(t.workspaceId, t.userId)]
);

export const invite = pgTable('invite', {
	id: uuid('id').primaryKey(),
	workspaceId: uuid('workspace_id')
		.notNull()
		.references(() => workspace.id),
	code: text('code').notNull().unique(),
	createdBy: uuid('created_by')
		.notNull()
		.references(() => workspaceMember.id),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	consumedBy: uuid('consumed_by').references(() => user.id),
	consumedAt: timestamp('consumed_at', { withTimezone: true })
});

export const category = pgTable(
	'category',
	{
		id: uuid('id').primaryKey(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id),
		name: text('name').notNull(),
		icon: text('icon'),
		color: text('color'),
		parentId: uuid('parent_id').references((): AnyPgColumn => category.id),
		isArchived: boolean('is_archived').notNull().default(false)
	},
	(t) => [index('category_workspace_idx').on(t.workspaceId)]
);

export const merchant = pgTable(
	'merchant',
	{
		id: uuid('id').primaryKey(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id),
		name: text('name').notNull(),
		normalizedName: text('normalized_name').notNull()
	},
	(t) => [uniqueIndex('merchant_workspace_normalized_uq').on(t.workspaceId, t.normalizedName)]
);

export const purchase = pgTable(
	'purchase',
	{
		id: uuid('id').primaryKey(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id),
		memberId: uuid('member_id')
			.notNull()
			.references(() => workspaceMember.id),
		state: purchaseState('state').notNull(),
		itemName: text('item_name').notNull(),
		note: text('note'),
		categoryId: uuid('category_id').references(() => category.id),
		merchantId: uuid('merchant_id').references(() => merchant.id),
		requestedAmountMinor: bigint('requested_amount_minor', { mode: 'bigint' }).notNull(),
		approvedAmountMinor: bigint('approved_amount_minor', { mode: 'bigint' }),
		finalAmountMinor: bigint('final_amount_minor', { mode: 'bigint' }),
		currency: text('currency').notNull(),
		sealedUntil: timestamp('sealed_until', { withTimezone: true }),
		sealedFromMemberIds: uuid('sealed_from_member_ids')
			.array()
			.notNull()
			.default(sql`'{}'::uuid[]`),
		requestedAt: timestamp('requested_at', { withTimezone: true }),
		decidedAt: timestamp('decided_at', { withTimezone: true }),
		completedAt: timestamp('completed_at', { withTimezone: true }),
		lastNudgedAt: timestamp('last_nudged_at', { withTimezone: true }),
		nudgeCount: integer('nudge_count').notNull().default(0),
		recurringRuleId: uuid('recurring_rule_id'),
		parentPurchaseId: uuid('parent_purchase_id').references((): AnyPgColumn => purchase.id),
		bucketId: uuid('bucket_id'),
		// "Sleep on it" hold: when the pause lifts, who set it, and whether the
		// "ready to decide" nudge has already gone out (so the sweep fires once).
		heldUntil: timestamp('held_until', { withTimezone: true }),
		heldBy: uuid('held_by'),
		heldNotifiedAt: timestamp('held_notified_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
	},
	(t) => [
		// Approver queue: pending requests per workspace, oldest first.
		index('purchase_pending_idx')
			.on(t.workspaceId, t.requestedAt)
			.where(sql`state = 'pending_approval'`),
		// Analytics scans.
		index('purchase_workspace_completed_idx').on(t.workspaceId, t.completedAt),
		// Seal filtering.
		index('purchase_sealed_from_gin').using('gin', t.sealedFromMemberIds),
		index('purchase_member_idx').on(t.memberId),
		// FK lookups: bucket detail lists its purchases, and archiving scans by it.
		index('purchase_bucket_idx').on(t.bucketId),
		// recurring_rule is declared below; declare the FK here to keep types happy.
		foreignKey({
			name: 'purchase_recurring_rule_fk',
			columns: [t.recurringRuleId],
			foreignColumns: [recurringRule.id]
		}),
		foreignKey({
			name: 'purchase_bucket_fk',
			columns: [t.bucketId],
			foreignColumns: [bucket.id]
		})
	]
);

// Snapshot of routing at request time — policy changes must not re-route pending requests.
export const purchaseApprover = pgTable(
	'purchase_approver',
	{
		purchaseId: uuid('purchase_id')
			.notNull()
			.references(() => purchase.id),
		memberId: uuid('member_id')
			.notNull()
			.references(() => workspaceMember.id),
		isRequired: boolean('is_required').notNull().default(false)
	},
	(t) => [primaryKey({ columns: [t.purchaseId, t.memberId] })]
);

export const purchaseImage = pgTable(
	'purchase_image',
	{
		id: uuid('id').primaryKey(),
		purchaseId: uuid('purchase_id')
			.notNull()
			.references(() => purchase.id),
		blobId: text('blob_id').notNull(),
		thumbBlobId: text('thumb_blob_id').notNull(),
		width: integer('width').notNull(),
		height: integer('height').notNull(),
		byteSize: integer('byte_size').notNull(),
		position: integer('position').notNull().default(0)
	},
	(t) => [index('purchase_image_purchase_idx').on(t.purchaseId)]
);

// Append-only. Never updated, never deleted.
export const approvalEvent = pgTable(
	'approval_event',
	{
		id: uuid('id').primaryKey(),
		purchaseId: uuid('purchase_id')
			.notNull()
			.references(() => purchase.id),
		actorMemberId: uuid('actor_member_id').references(() => workspaceMember.id),
		fromState: purchaseState('from_state'),
		toState: purchaseState('to_state').notNull(),
		reason: text('reason'),
		amountSnapshotMinor: bigint('amount_snapshot_minor', { mode: 'bigint' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull()
	},
	(t) => [index('approval_event_purchase_idx').on(t.purchaseId)]
);

export const recurringRule = pgTable(
	'recurring_rule',
	{
		id: uuid('id').primaryKey(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id),
		memberId: uuid('member_id')
			.notNull()
			.references(() => workspaceMember.id),
		itemName: text('item_name').notNull(),
		categoryId: uuid('category_id').references(() => category.id),
		merchantId: uuid('merchant_id').references(() => merchant.id),
		amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
		currency: text('currency').notNull(),
		rrule: text('rrule').notNull(),
		nextOccurrenceAt: timestamp('next_occurrence_at', { withTimezone: true }),
		lastGeneratedAt: timestamp('last_generated_at', { withTimezone: true }),
		status: recurringStatus('status').notNull().default('active'),
		autoComplete: boolean('auto_complete').notNull().default(false),
		endedAt: timestamp('ended_at', { withTimezone: true })
	},
	(t) => [index('recurring_rule_workspace_idx').on(t.workspaceId)]
);

export const income = pgTable(
	'income',
	{
		id: uuid('id').primaryKey(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id),
		memberId: uuid('member_id')
			.notNull()
			.references(() => workspaceMember.id),
		source: text('source').notNull(),
		amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
		currency: text('currency').notNull(),
		receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
		rrule: text('rrule'),
		note: text('note')
	},
	(t) => [index('income_workspace_received_idx').on(t.workspaceId, t.receivedAt)]
);

export const budget = pgTable(
	'budget',
	{
		id: uuid('id').primaryKey(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id),
		categoryId: uuid('category_id').references(() => category.id), // null = overall budget
		period: budgetPeriod('period').notNull(),
		amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
		effectiveFrom: date('effective_from').notNull(),
		effectiveTo: date('effective_to'),
		lastAlertedAt: timestamp('last_alerted_at', { withTimezone: true })
	},
	(t) => [index('budget_workspace_idx').on(t.workspaceId)]
);

export const bucket = pgTable(
	'bucket',
	{
		id: uuid('id').primaryKey(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspace.id),
		memberId: uuid('member_id')
			.notNull()
			.references(() => workspaceMember.id),
		name: text('name').notNull(),
		monthlyAmountMinor: bigint('monthly_amount_minor', { mode: 'bigint' }).notNull(),
		currency: text('currency').notNull(),
		goalCapMinor: bigint('goal_cap_minor', { mode: 'bigint' }),
		color: text('color'),
		icon: text('icon'),
		status: bucketStatus('status').notNull().default('active'),
		dayOfMonth: integer('day_of_month').notNull().default(1),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull()
	},
	(t) => [index('bucket_workspace_idx').on(t.workspaceId)]
);

export const bucketTransaction = pgTable(
	'bucket_transaction',
	{
		id: uuid('id').primaryKey(),
		bucketId: uuid('bucket_id')
			.notNull()
			.references(() => bucket.id),
		amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
		currency: text('currency').notNull(),
		type: bucketTxnType('type').notNull(),
		note: text('note'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull()
	},
	(t) => [index('bucket_txn_bucket_idx').on(t.bucketId)]
);

export const pushSubscription = pgTable('push_subscription', {
	id: uuid('id').primaryKey(),
	userId: uuid('user_id')
		.notNull()
		.references(() => user.id),
	endpoint: text('endpoint').notNull().unique(),
	p256dh: text('p256dh').notNull(),
	auth: text('auth').notNull(),
	userAgent: text('user_agent'),
	platform: text('platform'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
	lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
	failureCount: integer('failure_count').notNull().default(0)
});

export const ntfyTarget = pgTable('ntfy_target', {
	id: uuid('id').primaryKey(),
	userId: uuid('user_id')
		.notNull()
		.references(() => user.id),
	topic: text('topic').notNull(),
	serverUrl: text('server_url').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull()
});

export const notificationPref = pgTable(
	'notification_pref',
	{
		workspaceMemberId: uuid('workspace_member_id')
			.notNull()
			.references(() => workspaceMember.id),
		eventType: text('event_type').notNull(),
		channel: text('channel').notNull(),
		enabled: boolean('enabled').notNull().default(true)
	},
	(t) => [primaryKey({ columns: [t.workspaceMemberId, t.eventType, t.channel] })]
);

// Personal access tokens for the MCP server (and any future API surface).
// The secret is shown once at creation and never stored — only its SHA-256 hash
// is kept, so a database leak can't be replayed. Scoped to a single
// workspace_member, so every read/write acts as that person: seals, approval
// routing and permissions all apply exactly as they do in the web app.
export const apiToken = pgTable(
	'api_token',
	{
		id: uuid('id').primaryKey(),
		workspaceMemberId: uuid('workspace_member_id')
			.notNull()
			.references(() => workspaceMember.id),
		name: text('name').notNull(),
		/** SHA-256 hex of the secret. Unique so a lookup is a single indexed hit. */
		tokenHash: text('token_hash').notNull().unique(),
		/** First few visible chars (e.g. "ldg_A1b2") for the list — never the secret. */
		prefix: text('prefix').notNull(),
		/** Subset of ['read','write','approve']. Empty = no access (revoked shape). */
		scopes: text('scopes')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
		lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		revokedAt: timestamp('revoked_at', { withTimezone: true })
	},
	(t) => [index('api_token_member_idx').on(t.workspaceMemberId)]
);

// id is a high-entropy random token (not uuidv7 — session ids must be unguessable).
export const session = pgTable(
	'session',
	{
		id: text('id').primaryKey(),
		userId: uuid('user_id')
			.notNull()
			.references(() => user.id),
		activeWorkspaceId: uuid('active_workspace_id').references(() => workspace.id),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
		userAgent: text('user_agent'),
		ip: text('ip')
	},
	(t) => [index('session_user_idx').on(t.userId)]
);
