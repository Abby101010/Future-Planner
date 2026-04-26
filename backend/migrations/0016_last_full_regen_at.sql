-- 0016_last_full_regen_at
--
-- Phase E: rate-limit gate for L3 (full plan regeneration).
--
-- Background: L3 is the most expensive escalation path — Opus call
-- with the entire plan as context. The classifier's L3 trigger is
-- intentionally conservative (sustained 6+ week severe under-
-- performance OR explicit user "rebuild from scratch" request) but
-- without a server-side gate, a misbehaving caller (or a chat
-- intent loop, or a bug) could fire repeated full regens.
--
-- This column records the timestamp of the most recent successful
-- L3 run per goal. The classifier reads it via classifyAdjustment's
-- `goalLastFullRegenAt` input and returns rateLimited=true when the
-- elapsed time is < 30 days.
--
-- NULL means "never regenerated at L3" — first L3 is always allowed.
--
-- Stamped by runPlanLevelReschedule on success (added in the same
-- phase as this migration).

ALTER TABLE goals
  ADD COLUMN IF NOT EXISTS last_full_regen_at timestamptz;
