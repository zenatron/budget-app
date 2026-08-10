-- Marks an import whose lines came off a *picture* of a statement, transcribed
-- by a model, rather than off text the app read itself. Defaulted false, so
-- every existing import keeps saying what it already truthfully said.
--
-- Two jobs: the review screen shows it on every line, so nobody clears a match
-- against transcribed evidence without knowing that's what it is; and when
-- something is eventually built that turns a bank line into a ledger entry, this
-- is the column that feature has to refuse.
ALTER TABLE "statement_import" ADD COLUMN "model_read" boolean DEFAULT false NOT NULL;
