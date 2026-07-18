CREATE TYPE "public"."bucket_status" AS ENUM('active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."bucket_txn_type" AS ENUM('accrual', 'withdrawal', 'adjustment');--> statement-breakpoint
CREATE TABLE "bucket" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"name" text NOT NULL,
	"monthly_amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"goal_cap_minor" bigint,
	"color" text,
	"icon" text,
	"status" "bucket_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bucket_transaction" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bucket_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"type" "bucket_txn_type" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bucket" ADD CONSTRAINT "bucket_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bucket" ADD CONSTRAINT "bucket_member_id_workspace_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."workspace_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bucket_transaction" ADD CONSTRAINT "bucket_transaction_bucket_id_bucket_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."bucket"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bucket_workspace_idx" ON "bucket" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "bucket_txn_bucket_idx" ON "bucket_transaction" USING btree ("bucket_id");