-- 0012: Per-goal dashboard foundation.
-- Additive columns on goals table for the upcoming per-goal Dashboard feature.
-- Intelligence is driven by RAG retrieval (Phase 1 infra from migration 0009)
-- plus this metadata — not by hardcoded goal-type branching.
-- See ARCHITECTURE_UPGRADES.md for the retrieval pattern.
--
-- All existing goals get empty defaults; no backfill step needed.

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS goal_description      TEXT  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS goal_metadata         JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS user_notes            TEXT  NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS clarification_answers JSONB NOT NULL DEFAULT '{}';
