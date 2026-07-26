-- Buckets move from a fixed monthly day-of-month accrual to the same RRULE
-- subset recurring purchases use. Existing buckets keep their exact behavior:
-- a monthly rule on their former day_of_month, anchored to the day they were
-- created (in the workspace timezone, matching how the app computes dates).

ALTER TABLE "bucket" ADD COLUMN "rrule" text;

UPDATE "bucket" b
SET "rrule" = 'DTSTART='
	|| to_char(b.created_at AT TIME ZONE w.timezone, 'YYYY-MM-DD')
	|| ';FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY='
	|| b.day_of_month
FROM "workspace" w
WHERE w.id = b.workspace_id;

ALTER TABLE "bucket" ALTER COLUMN "rrule" SET NOT NULL;
ALTER TABLE "bucket" DROP COLUMN "day_of_month";
ALTER TABLE "bucket" RENAME COLUMN "monthly_amount_minor" TO "amount_minor";
