CREATE TYPE "public"."workspace_ai_mode" AS ENUM('off', 'local', 'external');--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "ai_mode" "workspace_ai_mode" DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "ai_endpoint" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "ai_model" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "ai_api_key" text;