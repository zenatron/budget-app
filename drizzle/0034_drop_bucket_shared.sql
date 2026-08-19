-- The boolean charge scope, superseded by charge_member_ids in 0033.
--
-- `shared = true` is `charge_member_ids IS NULL` (anyone) and `shared = false`
-- is an empty array (only the owner), so the backfill below carries every
-- bucket across before the column goes. Ordering matters: 0033 added the
-- column, this fills it from the old one and then drops it.
UPDATE "bucket" SET "charge_member_ids" = '{}' WHERE "shared" = false;--> statement-breakpoint
ALTER TABLE "bucket" DROP COLUMN "shared";
