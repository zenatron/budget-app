CREATE TABLE "pending_share" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"blob_id" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_share" ADD CONSTRAINT "pending_share_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_share" ADD CONSTRAINT "pending_share_member_id_workspace_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."workspace_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_share_member_idx" ON "pending_share" USING btree ("workspace_id","member_id","created_at");