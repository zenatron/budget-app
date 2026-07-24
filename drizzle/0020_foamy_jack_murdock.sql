ALTER TABLE "workspace" ALTER COLUMN "intelligence_enabled" SET DEFAULT true;--> statement-breakpoint
UPDATE "workspace" SET "intelligence_enabled" = true WHERE "intelligence_enabled" = false;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "safe_to_spend_alerts_enabled" boolean DEFAULT true NOT NULL;