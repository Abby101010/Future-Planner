-- NorthStar — 0002_entity_tables
--
-- Promotes domain data that currently lives inside the app_store JSON blob
-- into proper per-entity tables so the frontend can be rebuilt as a pure
-- display layer backed by narrow view-model queries.
--
-- This migration is ADDITIVE and NON-BREAKING:
--   * No DROP statements. app_store stays in place so the old store:load /
--     store:save path keeps working while repositories are cut over.
--   * Uses IF NOT EXISTS throughout so it is safe to re-run during dev.
--   * No data copy / backfill — repositories (Task 11) will start writing
--     to these tables, and a later migration will drop app_store once the
--     client is fully cut over.
--
-- Every table is user_id-scoped (text NOT NULL) to match the rest of the
-- schema and the AsyncLocalStorage request context.

-- ── Goals (big / everyday / repeating) ───────────────────
-- Backs the `goals` array in useStore / planning slice. The full shape of
-- the Goal type (plan, planChat, flatPlan, repeatSchedule, icon, notes,
-- progressPercent, scopeReasoning, rescheduleBannerDismissed, etc.) is
-- variable and hierarchical, so we promote only the stable top-level
-- fields to columns and stash the rest in `metadata` jsonb. Goal plan
-- hierarchy lives in goal_plan_nodes (below).
create table if not exists goals (
  id            text not null,
  user_id       text not null,
  title         text not null,
  description   text not null default '',
  target_date   text,                         -- ISO date string, nullable for habits
  category      text,                         -- free-form; core Goal has no category, reserved for future
  status        text not null default 'pending',  -- pending|planning|active|completed|archived
  priority      text not null default 'medium',   -- mirrors Goal.importance: low|medium|high|critical
  goal_type     text,                         -- big|everyday|repeating
  scope         text,                         -- small|big (NLP-classified)
  is_habit      boolean not null default false,
  icon          text,
  plan_confirmed boolean not null default false,
  progress_percent integer,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists idx_goals_user on goals(user_id);
create index if not exists idx_goals_user_status on goals(user_id, status);
create index if not exists idx_goals_user_target_date on goals(user_id, target_date);

-- ── Goal plan nodes (hierarchical year→month→week→day→task) ─
-- Normalizes GoalPlan { milestones, years[ months[ weeks[ days[ tasks[] ] ] ] ] }
-- into a single recursive table. parent_id points at the containing node.
-- The payload jsonb holds level-specific fields (objective, locked, duration,
-- priority, category, completed, completedAt, deliverables, etc.).
create table if not exists goal_plan_nodes (
  id            text not null,
  user_id       text not null,
  goal_id       text not null,
  parent_id     text,                          -- nullable for top-level nodes
  node_type     text not null,                 -- milestone|year|month|week|day|task
  title         text not null default '',
  description   text not null default '',
  start_date    text,                          -- ISO date string
  end_date      text,                          -- ISO date string
  order_index   integer not null default 0,
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists idx_goal_plan_nodes_user on goal_plan_nodes(user_id);
create index if not exists idx_goal_plan_nodes_user_goal on goal_plan_nodes(user_id, goal_id);
create index if not exists idx_goal_plan_nodes_user_goal_parent
  on goal_plan_nodes(user_id, goal_id, parent_id);
create index if not exists idx_goal_plan_nodes_user_type
  on goal_plan_nodes(user_id, node_type);

-- ── Daily logs (one row per user per day) ────────────────
-- Backs DailyLog top-level fields. Tasks for the day live in daily_tasks.
-- Variable shapes (notificationBriefing, milestoneCelebration, progress,
-- yesterdayRecap, encouragement) are stashed in `payload` so the view-model
-- query can project just what the UI needs.
create table if not exists daily_logs (
  user_id     text not null,
  log_date    date not null,
  mood        text,                            -- MoodEntry.level serialized as text (1..5) or null
  energy      text,                            -- reserved; not currently in DailyLog type
  notes       text,
  reflection  text,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, log_date)
);
create index if not exists idx_daily_logs_user on daily_logs(user_id);
create index if not exists idx_daily_logs_user_date on daily_logs(user_id, log_date);

-- ── Daily tasks (scheduled tasks for a given date) ───────
-- One row per DailyTask inside a DailyLog. Stable fields are columns;
-- the rest (description, durationMinutes, cognitiveWeight, whyToday,
-- priority, isMomentumTask, progressContribution, category, startedAt,
-- actualMinutes, snoozedCount, skipped) live in payload.
create table if not exists daily_tasks (
  id           text not null,
  user_id      text not null,
  log_date     date not null,
  goal_id      text,
  plan_node_id text,
  title        text not null,
  completed    boolean not null default false,
  completed_at timestamptz,
  order_index  integer not null default 0,
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists idx_daily_tasks_user on daily_tasks(user_id);
create index if not exists idx_daily_tasks_user_date on daily_tasks(user_id, log_date);
create index if not exists idx_daily_tasks_user_goal on daily_tasks(user_id, goal_id);

-- ── Pending tasks (AI-generated, awaiting user confirm) ──
-- Backs the pendingTasks slice. `source` records which agent produced it
-- (e.g. "home-chat", "planner"). The AI analysis (title, suggestedDate,
-- durationMinutes, cognitiveWeight, priority, category, reasoning,
-- conflictsWithExisting) lives in payload alongside the raw userInput.
create table if not exists pending_tasks (
  id          text not null,
  user_id     text not null,
  source      text not null default 'home-chat',
  title       text not null default '',
  status      text not null default 'pending',  -- pending|analyzing|ready|confirmed|rejected
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists idx_pending_tasks_user on pending_tasks(user_id);
create index if not exists idx_pending_tasks_user_status on pending_tasks(user_id, status);

-- ── Heatmap entries (activity level per day) ─────────────
-- Backs HeatmapEntry[]. completionLevel (0..4) is stored as `value` numeric
-- so we can later store fractional activity levels without a migration.
-- Streak metadata is kept on each DailyLog.payload; heatmap_entries stays
-- narrow since it is read for every day of the calendar grid.
create table if not exists heatmap_entries (
  user_id     text not null,
  entry_date  date not null,
  value       numeric not null default 0,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, entry_date)
);
create index if not exists idx_heatmap_entries_user on heatmap_entries(user_id);
create index if not exists idx_heatmap_entries_user_date on heatmap_entries(user_id, entry_date);

-- ── Home chat messages ───────────────────────────────────
-- Backs HomeChatMessage[] on the dashboard. Non-home chat threads (goal
-- planning, onboarding) already live in legacy chat_sessions.messages and
-- are indexed via `conversations` below — we do NOT recreate chat_sessions.
create table if not exists home_chat_messages (
  id          text not null,
  user_id     text not null,
  role        text not null,                    -- user|assistant|system
  content     text not null,
  payload     jsonb not null default '{}'::jsonb, -- pendingTaskId, tool calls, attachments refs
  created_at  timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists idx_home_chat_messages_user on home_chat_messages(user_id);
create index if not exists idx_home_chat_messages_user_created
  on home_chat_messages(user_id, created_at);

-- ── Conversations index (lightweight thread index) ───────
-- A narrow index over chat threads across surfaces (home dashboard, goal
-- plan page, onboarding). Message bodies for non-home kinds already live
-- in legacy chat_sessions — this table is purely for listing/sorting
-- threads in the sidebar without hydrating every message blob.
create table if not exists conversations (
  id              text not null,
  user_id         text not null,
  kind            text not null,                 -- home|goal-plan|onboarding
  title           text not null default '',
  last_message_at timestamptz,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists idx_conversations_user on conversations(user_id);
create index if not exists idx_conversations_user_kind on conversations(user_id, kind);
create index if not exists idx_conversations_user_last_msg
  on conversations(user_id, last_message_at desc);

-- ── Vacation mode (one row per user) ─────────────────────
-- Backs store.vacationMode = { active, startDate, endDate }. We add
-- `reason` for future UI surface (why is the user on vacation) since the
-- legacy shape only had active/start/end — the column is nullable so the
-- current client stays unchanged.
create table if not exists vacation_mode (
  user_id     text not null,
  active      boolean not null default false,
  start_date  date,
  end_date    date,
  reason      text,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id)
);
create index if not exists idx_vacation_mode_user on vacation_mode(user_id);

-- ── Nudges (AI reminders/prompts queued for the UI) ──────
-- Backs ContextualNudge[]. `kind` maps to ContextualNudge.type
-- (early_finish|snooze_probe|missed_deadline|dead_zone|overwhelm|
-- streak|proactive). `body` holds the human-readable message; actions
-- and priority/context live in payload.
create table if not exists nudges (
  id            text not null,
  user_id       text not null,
  kind          text not null,
  title         text not null default '',
  body          text not null default '',
  surfaced_at   timestamptz not null default now(),
  dismissed_at  timestamptz,
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists idx_nudges_user on nudges(user_id);
create index if not exists idx_nudges_user_surfaced on nudges(user_id, surfaced_at desc);
create index if not exists idx_nudges_user_kind on nudges(user_id, kind);

-- ── Behavior profile entries (learned signals) ───────────
-- A projection of memory_signals + memory_preferences shaped for fast
-- read by the behavior/insights UI. `category` groups signals (e.g.
-- "navigation", "task_completion"); `signal` is the specific key; weight
-- is the learned importance; observed_at is when it was last updated.
create table if not exists behavior_profile_entries (
  id           text not null,
  user_id      text not null,
  category     text not null,
  signal       text not null,
  weight       numeric not null default 0,
  observed_at  timestamptz not null default now(),
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists idx_behavior_profile_user
  on behavior_profile_entries(user_id);
create index if not exists idx_behavior_profile_user_category
  on behavior_profile_entries(user_id, category);
create index if not exists idx_behavior_profile_user_cat_signal
  on behavior_profile_entries(user_id, category, signal);
