ALTER TYPE "public"."purchase_state" ADD VALUE 'held';--> statement-breakpoint
ALTER TABLE "purchase" ADD COLUMN "held_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "purchase" ADD COLUMN "held_by" uuid;--> statement-breakpoint
ALTER TABLE "purchase" ADD COLUMN "held_notified_at" timestamp with time zone;