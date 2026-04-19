-- 0010: Phase A calendar upgrade.
-- Adds ISO timestamp scheduling columns, AI-estimated duration,
-- time-block status, and project tag. All additive; existing
-- payload.scheduledTime / payload.scheduledEndTime / payload.durationMinutes
-- fields remain in place and continue to be written (dual-write).

ALTER TABLE daily_tasks
  ADD COLUMN IF NOT EXISTS scheduled_start_time       timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_end_time         timestamptz,
  ADD COLUMN IF NOT EXISTS estimated_duration_minutes integer,
  ADD COLUMN IF NOT EXISTS time_block_status          text,
  ADD COLUMN IF NOT EXISTS project_tag                text;

-- Range queries on the calendar view scope by (user_id, scheduled_start_time).
CREATE INDEX IF NOT EXISTS daily_tasks_start_time_idx
  ON daily_tasks (user_id, scheduled_start_time)
  WHERE scheduled_start_time IS NOT NULL;

-- Project-view grouping.
CREATE INDEX IF NOT EXISTS daily_tasks_project_tag_idx
  ON daily_tasks (user_id, project_tag)
  WHERE project_tag IS NOT NULL;

-- Best-effort backfill: derive ISO from existing (log_date, payload->>'scheduledTime').
-- Treated as UTC since legacy rows have no per-row tz. Writers going forward
-- use users.payload.timezone to compute correct ISO.
UPDATE daily_tasks
SET scheduled_start_time = (log_date::text || ' ' || (payload->>'scheduledTime'))::timestamp AT TIME ZONE 'UTC'
WHERE scheduled_start_time IS NULL
  AND payload ? 'scheduledTime'
  AND (payload->>'scheduledTime') ~ '^\d{2}:\d{2}$';

UPDATE daily_tasks
SET scheduled_end_time = (log_date::text || ' ' || (payload->>'scheduledEndTime'))::timestamp AT TIME ZONE 'UTC'
WHERE scheduled_end_time IS NULL
  AND payload ? 'scheduledEndTime'
  AND (payload->>'scheduledEndTime') ~ '^\d{2}:\d{2}$';
