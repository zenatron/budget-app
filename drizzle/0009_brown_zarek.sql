ALTER TABLE "workspace" ADD COLUMN "intelligence_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD COLUMN "summary_cadence" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD COLUMN "summary_last_sent_at" timestamp with time zone;