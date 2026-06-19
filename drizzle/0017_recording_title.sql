-- Phase 34 — Quick-Record + Recordings Inbox + Manual Assign.
-- Additive: an optional rep-given label for a recording. Nullable, no default,
-- no data movement — zero data-loss. The inbox shows this when present and falls
-- back to a date label otherwise.
ALTER TABLE "recordings" ADD COLUMN IF NOT EXISTS "title" text;
