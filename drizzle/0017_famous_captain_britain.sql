ALTER TABLE "workspace" ADD COLUMN "budget_alert_pct" integer DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "budget_alert_cooldown_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "recent_delete_hours" integer DEFAULT 72 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "max_nudges" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "invite_ttl_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "recurring_catchup_max" integer DEFAULT 36 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "unique_categories" boolean DEFAULT false NOT NULL;