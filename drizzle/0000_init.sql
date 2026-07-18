CREATE TYPE "public"."budget_period" AS ENUM('month', 'week');--> statement-breakpoint
CREATE TYPE "public"."workspace_member_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."workspace_member_status" AS ENUM('active', 'invited', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."purchase_state" AS ENUM('draft', 'pending_approval', 'approved', 'denied', 'cancelled', 'completed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."recurring_rule_status" AS ENUM('active', 'paused', 'ended');--> statement-breakpoint
CREATE TABLE "approval_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purchase_id" uuid NOT NULL,
	"actor_member_id" uuid,
	"from_state" "purchase_state",
	"to_state" "purchase_state" NOT NULL,
	"reason" text,
	"amount_snapshot_minor" bigint,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"category_id" uuid,
	"period" "budget_period" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"color" text,
	"parent_id" uuid,
	"is_archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "income" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"source" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"rrule" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_by" uuid,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "invite_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "merchant" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_pref" (
	"workspace_member_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "notification_pref_workspace_member_id_event_type_channel_pk" PRIMARY KEY("workspace_member_id","event_type","channel")
);
--> statement-breakpoint
CREATE TABLE "ntfy_target" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"server_url" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"state" "purchase_state" NOT NULL,
	"item_name" text NOT NULL,
	"note" text,
	"category_id" uuid,
	"merchant_id" uuid,
	"requested_amount_minor" bigint NOT NULL,
	"approved_amount_minor" bigint,
	"final_amount_minor" bigint,
	"currency" text NOT NULL,
	"sealed_until" timestamp with time zone,
	"sealed_from_member_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"requested_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_nudged_at" timestamp with time zone,
	"nudge_count" integer DEFAULT 0 NOT NULL,
	"recurring_rule_id" uuid,
	"parent_purchase_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_approver" (
	"purchase_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	CONSTRAINT "purchase_approver_purchase_id_member_id_pk" PRIMARY KEY("purchase_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "purchase_image" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purchase_id" uuid NOT NULL,
	"blob_id" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_size" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscription" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"platform" text,
	"created_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "push_subscription_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "recurring_rule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"item_name" text NOT NULL,
	"category_id" uuid,
	"merchant_id" uuid,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"rrule" text NOT NULL,
	"next_occurrence_at" timestamp with time zone,
	"last_generated_at" timestamp with time zone,
	"status" "recurring_rule_status" DEFAULT 'active' NOT NULL,
	"auto_complete" boolean DEFAULT false NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"active_workspace_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"oidc_subject" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_blob_id" text,
	"is_deployment_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "app_user_oidc_subject_unique" UNIQUE("oidc_subject")
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"timezone" text NOT NULL,
	"week_start_day" smallint DEFAULT 1 NOT NULL,
	"stale_after_hours" integer DEFAULT 48 NOT NULL,
	"reapproval_threshold_pct" integer DEFAULT 10 NOT NULL,
	"sealed_purchase_cap_minor" bigint,
	"max_seal_days" integer DEFAULT 90 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "workspace_member" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "workspace_member_role" DEFAULT 'member' NOT NULL,
	"approval_policy" jsonb NOT NULL,
	"status" "workspace_member_status" DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_event" ADD CONSTRAINT "approval_event_purchase_id_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_event" ADD CONSTRAINT "approval_event_actor_member_id_workspace_member_id_fk" FOREIGN KEY ("actor_member_id") REFERENCES "public"."workspace_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget" ADD CONSTRAINT "budget_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget" ADD CONSTRAINT "budget_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_category_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income" ADD CONSTRAINT "income_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income" ADD CONSTRAINT "income_member_id_workspace_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."workspace_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_created_by_workspace_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."workspace_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_consumed_by_app_user_id_fk" FOREIGN KEY ("consumed_by") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant" ADD CONSTRAINT "merchant_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_pref" ADD CONSTRAINT "notification_pref_workspace_member_id_workspace_member_id_fk" FOREIGN KEY ("workspace_member_id") REFERENCES "public"."workspace_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ntfy_target" ADD CONSTRAINT "ntfy_target_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_member_id_workspace_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."workspace_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_merchant_id_merchant_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_parent_purchase_id_purchase_id_fk" FOREIGN KEY ("parent_purchase_id") REFERENCES "public"."purchase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_recurring_rule_fk" FOREIGN KEY ("recurring_rule_id") REFERENCES "public"."recurring_rule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_approver" ADD CONSTRAINT "purchase_approver_purchase_id_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_approver" ADD CONSTRAINT "purchase_approver_member_id_workspace_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."workspace_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_image" ADD CONSTRAINT "purchase_image_purchase_id_purchase_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rule" ADD CONSTRAINT "recurring_rule_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rule" ADD CONSTRAINT "recurring_rule_member_id_workspace_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."workspace_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rule" ADD CONSTRAINT "recurring_rule_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rule" ADD CONSTRAINT "recurring_rule_merchant_id_merchant_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchant"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_active_workspace_id_workspace_id_fk" FOREIGN KEY ("active_workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_owner_user_id_app_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_event_purchase_idx" ON "approval_event" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "budget_workspace_idx" ON "budget" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "category_workspace_idx" ON "category" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "income_workspace_received_idx" ON "income" USING btree ("workspace_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_workspace_normalized_uq" ON "merchant" USING btree ("workspace_id","normalized_name");--> statement-breakpoint
CREATE INDEX "purchase_pending_idx" ON "purchase" USING btree ("workspace_id","requested_at") WHERE state = 'pending_approval';--> statement-breakpoint
CREATE INDEX "purchase_workspace_completed_idx" ON "purchase" USING btree ("workspace_id","completed_at");--> statement-breakpoint
CREATE INDEX "purchase_sealed_from_gin" ON "purchase" USING gin ("sealed_from_member_ids");--> statement-breakpoint
CREATE INDEX "purchase_member_idx" ON "purchase" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "purchase_image_purchase_idx" ON "purchase_image" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "recurring_rule_workspace_idx" ON "recurring_rule" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_member_workspace_user_uq" ON "workspace_member" USING btree ("workspace_id","user_id");