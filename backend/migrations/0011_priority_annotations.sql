-- 0011: Phase B priority system upgrade.
-- Adds three per-task priority annotations driven by a new priorityAnnotator
-- agent that runs in parallel with gatekeeper. All additive; existing tasks
-- remain null on these fields and continue to schedule under current rules.
--
-- Frameworks encoded:
--   - cognitive_load : dual-process theory (System 1 vs System 2)
--   - cognitive_cost : cognitive load theory (per-task numeric cost 1..10)
--   - tier           : value tiering (lifetime / quarter / week / day)
--
-- No backfill: pre-Phase-B tasks stay null. Only newly planned tasks get
-- values filled by the priorityAnnotator agent.
--
-- The per-user `dailyCognitiveBudget` lives on users.settings (JSONB), so
-- no column migration is needed for that setting.

ALTER TABLE daily_tasks
  ADD COLUMN IF NOT EXISTS cognitive_load  text,
  ADD COLUMN IF NOT EXISTS cognitive_cost  integer,
  ADD COLUMN IF NOT EXISTS tier            text;

-- Critique's "zero lifetime/quarter tasks for N consecutive days" check
-- scans (user_id, log_date, tier). Partial index keeps it cheap.
CREATE INDEX IF NOT EXISTS daily_tasks_tier_idx
  ON daily_tasks (user_id, log_date, tier)
  WHERE tier IS NOT NULL;
