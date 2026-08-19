-- Weekly budgets. The enum always carried 'week'; the writer and every reader
-- hardcoded 'month', so the value was a promise nothing honored. This gives
-- the promise a body.
--
-- Alert state was keyed by (workspace, category, month) — 'YYYY-MM'. A weekly
-- budget overspends on its own clock, so its cooldowns must live on that
-- clock too: the column is renamed to period_key, monthly rows keep their
-- 'YYYY-MM' values untouched, and weekly rows key by the week's first day
-- 'YYYY-MM-DD'. The two shapes cannot collide, so no discriminator column is
-- needed. The unique index follows the rename.
ALTER TABLE "budget_alert_log" RENAME COLUMN "month" TO "period_key";--> statement-breakpoint
ALTER INDEX "budget_alert_log_scope_idx" RENAME TO "budget_alert_log_scope_idx_old";--> statement-breakpoint
CREATE UNIQUE INDEX "budget_alert_log_scope_idx" ON "budget_alert_log" USING btree ("workspace_id", "category_key", "period_key");--> statement-breakpoint
DROP INDEX "budget_alert_log_scope_idx_old";
