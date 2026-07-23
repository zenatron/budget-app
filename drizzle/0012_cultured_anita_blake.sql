ALTER TABLE "workspace_member" ADD COLUMN "safe_to_spend_alert_month" date;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD COLUMN "safe_to_spend_alert_level" integer DEFAULT 0 NOT NULL;