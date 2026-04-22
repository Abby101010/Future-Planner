-- 0008: Add explicit `source` column to daily_tasks.
--
-- Drives task lifecycle branching: big_goal tasks have different
-- completion/can't-complete/delete behavior than user_created ones.
-- Values: big_goal, user_created, calendar, repeating_goal.
--
-- Previously tracked in payload jsonb under various ad-hoc keys;
-- this promotes it to a first-class indexed column.

ALTER TABLE daily_tasks
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'user_created';

-- Backfill: any task linked to a goal is from a big-goal plan.
UPDATE daily_tasks
   SET source = 'big_goal'
 WHERE goal_id IS NOT NULL;

-- Backfill: calendar events (have scheduledTime, no goal link).
UPDATE daily_tasks
   SET source = 'calendar'
 WHERE goal_id IS NULL
   AND payload->>'isAllDay' = 'true';

-- Backfill: repeating goal tasks (have recurring pattern, no goal link).
UPDATE daily_tasks
   SET source = 'repeating_goal'
 WHERE goal_id IS NULL
   AND payload->>'recurring' IS NOT NULL;

-- Index for filtering by source (used by Daily Planner Coordinator).
CREATE INDEX IF NOT EXISTS idx_daily_tasks_source
    ON daily_tasks (user_id, source);
