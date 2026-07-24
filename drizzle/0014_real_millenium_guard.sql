CREATE TYPE "public"."statement_import_format" AS ENUM('csv', 'ofx');--> statement-breakpoint
CREATE TYPE "public"."statement_line_match_state" AS ENUM('unmatched', 'matched', 'confirmed', 'private', 'ignored');--> statement-breakpoint
CREATE TABLE "statement_import" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"format" "statement_import_format" NOT NULL,
	"currency" text NOT NULL,
	"blob_id" text,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"line_count" integer NOT NULL,
	"matched_count" integer NOT NULL,
	"status" text DEFAULT 'reviewing' NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statement_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"import_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"raw_description" text NOT NULL,
	"normalized_description" text NOT NULL,
	"external_id" text,
	"match_state" "statement_line_match_state" DEFAULT 'unmatched' NOT NULL,
	"matched_purchase_id" uuid,
	"match_reason" text,
	"dedup_hash" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase" ADD COLUMN "cleared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "keep_statement_files" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "statement_import" ADD CONSTRAINT "statement_import_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_import" ADD CONSTRAINT "statement_import_member_id_workspace_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."workspace_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_line" ADD CONSTRAINT "statement_line_import_id_statement_import_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."statement_import"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_line" ADD CONSTRAINT "statement_line_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_line" ADD CONSTRAINT "statement_line_matched_purchase_id_purchase_id_fk" FOREIGN KEY ("matched_purchase_id") REFERENCES "public"."purchase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "statement_import_workspace_idx" ON "statement_import" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "statement_line_import_idx" ON "statement_line" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "statement_line_matched_purchase_idx" ON "statement_line" USING btree ("matched_purchase_id");--> statement-breakpoint
CREATE UNIQUE INDEX "statement_line_import_dedup_uq" ON "statement_line" USING btree ("import_id","dedup_hash");