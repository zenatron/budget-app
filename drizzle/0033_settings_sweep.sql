-- A sweep of settings that had no home, or the wrong one.
--
-- settle_up: "who owes whom" on Activity assumes a household that splits its
-- spending. Plenty don't, and for them it is a whole section of the page
-- answering a question nobody asked. Defaults on, which is today's behavior.
--
-- charge_member_ids: the bucket charge scope, widened from the boolean that
-- preceded it (dropped in 0034). Null means anyone in the workspace, which is
-- how buckets have always behaved. A list names exactly who else may charge
-- it; empty is therefore "only me". The owner is always implied.
--
-- safe_to_spend_display: the default flips to 'masked'. The number reads
-- across a café from the next table, so the discreet reading is the one you
-- should have to opt out of. Existing rows keep whatever they were set to.
--
-- show_runway_months: whether the Safe to Spend breakdown projects the months
-- after this one. Defaults on, which is today's behavior.
ALTER TABLE "workspace_member" ALTER COLUMN "safe_to_spend_display" SET DEFAULT 'masked';--> statement-breakpoint
ALTER TABLE "bucket" ADD COLUMN "charge_member_ids" uuid[];--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "settle_up_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD COLUMN "show_runway_months" boolean DEFAULT true NOT NULL;
