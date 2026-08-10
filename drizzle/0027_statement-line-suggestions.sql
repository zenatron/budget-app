-- The matcher already ranks the top candidates for every line it won't claim;
-- until now that ranking was computed and thrown away, so an ambiguous line
-- landed in review as a bare `unmatched` row with a blank search box. Keep it.
--
-- Ids only, no foreign key, defaulted so every existing line reads as "we
-- ranked nothing" rather than null: this is a hint the review screen re-checks
-- against seal-filtered purchases before showing, never a relationship.
ALTER TABLE "statement_line" ADD COLUMN "suggested_purchase_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
