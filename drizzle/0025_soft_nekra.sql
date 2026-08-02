-- Accounts (cards) for reconciliation, plus 'pdf' as a statement format.
--
-- The statement_import_format swap below drops 'ofx' and adds 'pdf'. Dropping an
-- enum value is only safe when nothing holds it: 'ofx' was declared when the
-- table was written but no import path ever produced it, so the USING cast
-- cannot fail. If that ever stops being true this migration must be revisited.
CREATE TYPE "public"."account_kind" AS ENUM('card', 'bank');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"last4" text,
	"kind" "account_kind" DEFAULT 'card' NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "statement_import" ALTER COLUMN "format" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."statement_import_format";--> statement-breakpoint
CREATE TYPE "public"."statement_import_format" AS ENUM('csv', 'pdf');--> statement-breakpoint
ALTER TABLE "statement_import" ALTER COLUMN "format" SET DATA TYPE "public"."statement_import_format" USING "format"::"public"."statement_import_format";--> statement-breakpoint
ALTER TABLE "purchase" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "statement_import" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_workspace_idx" ON "account" USING btree ("workspace_id","is_archived");--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_import" ADD CONSTRAINT "statement_import_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;