-- 0007: Unify tasks & calendar events
--
-- Migrates any existing calendar_events rows into daily_tasks (preserving
-- all data in the payload jsonb), then drops the calendar_events table.

INSERT INTO daily_tasks (id, user_id, log_date, title, completed, order_index, payload)
SELECT
  id,
  user_id,
  start_date::date,
  title,
  false,
  0,
  jsonb_build_object(
    'description', coalesce(notes, ''),
    'durationMinutes', duration_minutes,
    'priority', 'should-do',
    'category', category,
    'scheduledTime', CASE WHEN NOT is_all_day THEN to_char(start_date::timestamptz, 'HH24:MI') ELSE NULL END,
    'scheduledEndTime', CASE WHEN NOT is_all_day THEN to_char(end_date::timestamptz, 'HH24:MI') ELSE NULL END,
    'isAllDay', is_all_day,
    'isVacation', is_vacation,
    'notes', notes,
    'color', color,
    'source', 'calendar'
  ) || CASE
    WHEN recurring_freq IS NOT NULL THEN jsonb_build_object(
      'recurring', jsonb_build_object('frequency', recurring_freq, 'until', recurring_until)
    )
    ELSE '{}'::jsonb
  END
FROM calendar_events
ON CONFLICT DO NOTHING;

DROP TABLE IF EXISTS calendar_events;
