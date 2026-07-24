ALTER TABLE "category" ADD COLUMN "is_built_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "category" SET "is_built_in" = true WHERE "is_built_in" = false;