-- NorthStar — Postgres schema
-- Translated from electron/db/migrations.ts (SQLite).
--
-- MULTI-USER-READY FROM DAY 1:
--   Every table carries `user_id text not null` even though phase 1 only has
--   one user (Sophie). Adding this column now is free; adding it later would
--   require a migration + backfill across every table. Phase 2 auth middleware
--   will swap the hardcoded user_id for a real JWT-verified value without
--   touching any query or route.

-- ── Memory: facts ────────────────────────────────────────
create table if not exists memory_facts (
  id          text not null,
  user_id     text not null,
  category    text not null,
  key         text not null,
  value       text not null,
  confidence  double precision not null default 0.3,
  evidence    jsonb not null default '[]'::jsonb,
  source      text not null default 'reflection',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists idx_memory_facts_user_cat_key
  on memory_facts(user_id, category, key);

-- ── Memory: preferences ──────────────────────────────────
create table if not exists memory_preferences (
  id          text not null,
  user_id     text not null,
  text        text not null,
  tags        jsonb not null default '[]'::jsonb,
  weight      double precision not null default 0,
  frequency   integer not null default 1,
  examples    jsonb not null default '[]'::jsonb,
  embedding   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);

-- ── Memory: signals ──────────────────────────────────────
create table if not exists memory_signals (
  id         text not null,
  user_id    text not null,
  type       text not null,
  context    text not null,
  value      text not null,
  timestamp  timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists idx_memory_signals_user_type
  on memory_signals(user_id, type);
create index if not exists idx_memory_signals_user_ts
  on memory_signals(user_id, timestamp);

-- ── Memory: snooze records ───────────────────────────────
create table if not exists memory_snooze_records (
  id            bigserial,
  user_id       text not null,
  task_title    text not null,
  task_category text not null,
  snooze_count  integer not null default 1,
  original_date text not null,
  last_snoozed  timestamptz not null default now(),
  primary key (user_id, id),
  unique (user_id, task_title, original_date)
);

-- ── Memory: task timings (calibration) ───────────────────
create table if not exists memory_task_timings (
  id                bigserial,
  user_id           text not null,
  task_category     text not null,
  task_keywords     jsonb not null default '[]'::jsonb,
  estimated_minutes integer not null,
  actual_minutes    integer not null,
  date              text not null,
  primary key (user_id, id)
);
create index if not exists idx_memory_timings_user_cat
  on memory_task_timings(user_id, task_category);

-- ── Memory: reflection metadata ──────────────────────────
create table if not exists memory_meta (
  user_id             text primary key,
  last_reflection_at  timestamptz,
  reflection_count    integer not null default 0,
  version             integer not null default 1
);

-- ── App store (key/value JSON per user) ──────────────────
-- Top-level app state snapshot. Keys are things like 'user', 'goals', 'logs'.
-- Renderer does store:load once on startup, store:save on every mutation.
create table if not exists app_store (
  user_id  text not null,
  key      text not null,
  value    jsonb not null default '{}'::jsonb,
  primary key (user_id, key)
);

-- ── Calendar events ──────────────────────────────────────
create table if not exists calendar_events (
  id               text not null,
  user_id          text not null,
  title            text not null,
  start_date       text not null,
  end_date         text not null,
  is_all_day       boolean not null default false,
  duration_minutes integer not null default 60,
  category         text not null default 'personal',
  is_vacation      boolean not null default false,
  source           text not null default 'manual',
  source_calendar  text,
  color            text,
  notes            text,
  recurring_freq   text,
  recurring_until  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists idx_cal_events_user_date
  on calendar_events(user_id, start_date);

-- ── Job queue ────────────────────────────────────────────
create table if not exists job_queue (
  id            text not null,
  user_id       text not null,
  type          text not null,
  status        text not null default 'pending',
  payload       jsonb not null default '{}'::jsonb,
  result        jsonb,
  error         text,
  progress      integer not null default 0,
  progress_log  jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  completed_at  timestamptz,
  retry_count   integer not null default 0,
  max_retries   integer not null default 2,
  primary key (user_id, id)
);
create index if not exists idx_job_queue_user_status
  on job_queue(user_id, status);
create index if not exists idx_job_queue_user_type
  on job_queue(user_id, type);

-- ── Monthly contexts ─────────────────────────────────────
create table if not exists monthly_contexts (
  user_id             text not null,
  month               text not null,
  description         text not null default '',
  intensity           text not null default 'normal',
  intensity_reasoning text not null default '',
  capacity_multiplier double precision not null default 1.0,
  max_daily_tasks     integer not null default 4,
  updated_at          timestamptz not null default now(),
  primary key (user_id, month)
);

-- ── Chat sessions ────────────────────────────────────────
create table if not exists chat_sessions (
  id          text not null,
  user_id     text not null,
  title       text not null default 'New chat',
  messages    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, id)
);

-- ── Chat attachments ─────────────────────────────────────
-- Slice 5: bytes are stored inline as bytea so chat history (with images and
-- PDFs) syncs across devices without requiring a separate object store. We
-- can swap to Supabase Storage later if size pressure becomes a problem;
-- for a personal app the inline approach is fine.
create table if not exists chat_attachments (
  id          text not null,
  user_id     text not null,
  session_id  text not null,
  message_id  text not null,
  filename    text not null,
  mime_type   text not null,
  file_path   text,
  file_type   text not null default 'image',
  size_bytes  integer not null default 0,
  bytes       bytea,
  created_at  timestamptz not null default now(),
  primary key (user_id, id)
);
-- Make file_path nullable for installs that ran the old schema (slice 5
-- migration). add column if not exists handles fresh installs already.
alter table chat_attachments alter column file_path drop not null;
alter table chat_attachments add column if not exists bytes bytea;
create index if not exists idx_chat_attachments_user_session
  on chat_attachments(user_id, session_id);
create index if not exists idx_chat_attachments_user_message
  on chat_attachments(user_id, message_id);

-- ── Reminders ────────────────────────────────────────────
create table if not exists reminders (
  id              text not null,
  user_id         text not null,
  title           text not null,
  description     text not null default '',
  reminder_time   text not null,
  date            text not null,
  acknowledged    boolean not null default false,
  acknowledged_at timestamptz,
  repeat          text,
  source          text not null default 'chat',
  created_at      timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists idx_reminders_user_date
  on reminders(user_id, date);
