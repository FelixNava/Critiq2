-- Phase 35a — Add Context (rep-level + account-level free-text).
-- Additive only, zero data-loss: a new rep-private table + one nullable shared
-- column on account_records. Both are null/absent on every existing row.

-- Rep-level context: "what should Critiq know about how you sell" — one row per
-- rep, REP-PRIVATE (rep-side data is isolated per the locked privacy model).
CREATE TABLE IF NOT EXISTS "rep_context" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "context" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "rep_context"
    ADD CONSTRAINT "rep_context_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "rep_context_user_id_key" ON "rep_context" ("user_id");
--> statement-breakpoint
-- Account-level context: a SHARED, human-entered "what Critiq should know about
-- this account" note (account intelligence is shared across reps — the account is
-- the first-class entity). Distinct from account_records.summary, which Phase 23
-- regenerates automatically; this column is only ever written by a rep.
ALTER TABLE "account_records" ADD COLUMN IF NOT EXISTS "context" text;
