CREATE TABLE "budget_alert_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"category_key" text NOT NULL,
	"month" text NOT NULL,
	"level" text NOT NULL,
	"actual_minor" bigint NOT NULL,
	"last_alerted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_alert_log" ADD CONSTRAINT "budget_alert_log_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_alert_log_scope_idx" ON "budget_alert_log" USING btree ("workspace_id","category_key","month");--> statement-breakpoint
ALTER TABLE "budget" DROP COLUMN "last_alerted_at";