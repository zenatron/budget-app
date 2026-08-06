-- Safe to Spend discretion, per member: 'shown' | 'masked' | 'off'. A display
-- preference (see domain/visibility/discretion), not access control — text with
-- a default so every existing member keeps today's behaviour.
ALTER TABLE "workspace_member" ADD COLUMN "safe_to_spend_display" text DEFAULT 'shown' NOT NULL;
