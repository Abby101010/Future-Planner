-- NorthStar — 0006_enable_rls
--
-- Enables Row Level Security on all user-scoped tables and creates
-- policies that restrict access to rows matching auth.uid(). The
-- server connects as postgres (superuser) which bypasses RLS, so
-- these policies act as defense-in-depth for any direct Supabase
-- client access.
--
-- Skipped: schema_migrations (no user_id column).

-- ── Helper: create RLS policy on a table ────────────────
-- Using DO blocks to make the migration idempotent (policies are
-- created only if they don't already exist).

-- memory_facts
ALTER TABLE memory_facts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'memory_facts' AND policyname = 'users_own_memory_facts') THEN
    CREATE POLICY users_own_memory_facts ON memory_facts FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- memory_preferences
ALTER TABLE memory_preferences ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'memory_preferences' AND policyname = 'users_own_memory_preferences') THEN
    CREATE POLICY users_own_memory_preferences ON memory_preferences FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- memory_signals
ALTER TABLE memory_signals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'memory_signals' AND policyname = 'users_own_memory_signals') THEN
    CREATE POLICY users_own_memory_signals ON memory_signals FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- memory_snooze_records
ALTER TABLE memory_snooze_records ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'memory_snooze_records' AND policyname = 'users_own_memory_snooze_records') THEN
    CREATE POLICY users_own_memory_snooze_records ON memory_snooze_records FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- memory_task_timings
ALTER TABLE memory_task_timings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'memory_task_timings' AND policyname = 'users_own_memory_task_timings') THEN
    CREATE POLICY users_own_memory_task_timings ON memory_task_timings FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- memory_meta
ALTER TABLE memory_meta ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'memory_meta' AND policyname = 'users_own_memory_meta') THEN
    CREATE POLICY users_own_memory_meta ON memory_meta FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- app_store
ALTER TABLE app_store ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'app_store' AND policyname = 'users_own_app_store') THEN
    CREATE POLICY users_own_app_store ON app_store FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- calendar_events
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'calendar_events' AND policyname = 'users_own_calendar_events') THEN
    CREATE POLICY users_own_calendar_events ON calendar_events FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- job_queue
ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'job_queue' AND policyname = 'users_own_job_queue') THEN
    CREATE POLICY users_own_job_queue ON job_queue FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- monthly_contexts
ALTER TABLE monthly_contexts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'monthly_contexts' AND policyname = 'users_own_monthly_contexts') THEN
    CREATE POLICY users_own_monthly_contexts ON monthly_contexts FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- chat_sessions
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'chat_sessions' AND policyname = 'users_own_chat_sessions') THEN
    CREATE POLICY users_own_chat_sessions ON chat_sessions FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- chat_attachments
ALTER TABLE chat_attachments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'chat_attachments' AND policyname = 'users_own_chat_attachments') THEN
    CREATE POLICY users_own_chat_attachments ON chat_attachments FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- reminders
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'reminders' AND policyname = 'users_own_reminders') THEN
    CREATE POLICY users_own_reminders ON reminders FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- goals
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goals' AND policyname = 'users_own_goals') THEN
    CREATE POLICY users_own_goals ON goals FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- goal_plan_nodes
ALTER TABLE goal_plan_nodes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'goal_plan_nodes' AND policyname = 'users_own_goal_plan_nodes') THEN
    CREATE POLICY users_own_goal_plan_nodes ON goal_plan_nodes FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- daily_logs
ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'daily_logs' AND policyname = 'users_own_daily_logs') THEN
    CREATE POLICY users_own_daily_logs ON daily_logs FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- daily_tasks
ALTER TABLE daily_tasks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'daily_tasks' AND policyname = 'users_own_daily_tasks') THEN
    CREATE POLICY users_own_daily_tasks ON daily_tasks FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- pending_tasks
ALTER TABLE pending_tasks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'pending_tasks' AND policyname = 'users_own_pending_tasks') THEN
    CREATE POLICY users_own_pending_tasks ON pending_tasks FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- heatmap_entries
ALTER TABLE heatmap_entries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'heatmap_entries' AND policyname = 'users_own_heatmap_entries') THEN
    CREATE POLICY users_own_heatmap_entries ON heatmap_entries FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- home_chat_messages
ALTER TABLE home_chat_messages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'home_chat_messages' AND policyname = 'users_own_home_chat_messages') THEN
    CREATE POLICY users_own_home_chat_messages ON home_chat_messages FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- conversations
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'conversations' AND policyname = 'users_own_conversations') THEN
    CREATE POLICY users_own_conversations ON conversations FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- vacation_mode
ALTER TABLE vacation_mode ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'vacation_mode' AND policyname = 'users_own_vacation_mode') THEN
    CREATE POLICY users_own_vacation_mode ON vacation_mode FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- nudges
ALTER TABLE nudges ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'nudges' AND policyname = 'users_own_nudges') THEN
    CREATE POLICY users_own_nudges ON nudges FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- behavior_profile_entries
ALTER TABLE behavior_profile_entries ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'behavior_profile_entries' AND policyname = 'users_own_behavior_profile_entries') THEN
    CREATE POLICY users_own_behavior_profile_entries ON behavior_profile_entries FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'users' AND policyname = 'users_own_users') THEN
    CREATE POLICY users_own_users ON users FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;

-- roadmap
ALTER TABLE roadmap ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'roadmap' AND policyname = 'users_own_roadmap') THEN
    CREATE POLICY users_own_roadmap ON roadmap FOR ALL USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;
END $$;
