ALTER TABLE "purchase" ADD COLUMN "bucket_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "bucket_charges_skip_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_bucket_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."bucket"("id") ON DELETE no action ON UPDATE no action;