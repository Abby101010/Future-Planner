/* NorthStar — SQLite schema migrations */

import { getDB } from "./connection";

export async function runMigrations(): Promise<void> {
  const d = getDB();

  d.exec(`
    CREATE TABLE IF NOT EXISTS memory_facts (
      id            TEXT PRIMARY KEY,
      category      TEXT NOT NULL,
      key           TEXT NOT NULL,
      value         TEXT NOT NULL,
      confidence    REAL NOT NULL DEFAULT 0.3,
      evidence      TEXT NOT NULL DEFAULT '[]',
      source        TEXT NOT NULL DEFAULT 'reflection',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_memory_facts_cat_key
      ON memory_facts(category, key);

    CREATE TABLE IF NOT EXISTS memory_preferences (
      id            TEXT PRIMARY KEY,
      text          TEXT NOT NULL,
      tags          TEXT NOT NULL DEFAULT '[]',
      weight        REAL NOT NULL DEFAULT 0,
      frequency     INTEGER NOT NULL DEFAULT 1,
      examples      TEXT NOT NULL DEFAULT '[]',
      embedding     TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memory_signals (
      id            TEXT PRIMARY KEY,
      type          TEXT NOT NULL,
      context       TEXT NOT NULL,
      value         TEXT NOT NULL,
      timestamp     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_memory_signals_type
      ON memory_signals(type);
    CREATE INDEX IF NOT EXISTS idx_memory_signals_ts
      ON memory_signals(timestamp);

    CREATE TABLE IF NOT EXISTS memory_snooze_records (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      task_title    TEXT NOT NULL,
      task_category TEXT NOT NULL,
      snooze_count  INTEGER NOT NULL DEFAULT 1,
      original_date TEXT NOT NULL,
      last_snoozed  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(task_title, original_date)
    );

    CREATE TABLE IF NOT EXISTS memory_task_timings (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      task_category     TEXT NOT NULL,
      task_keywords     TEXT NOT NULL DEFAULT '[]',
      estimated_minutes INTEGER NOT NULL,
      actual_minutes    INTEGER NOT NULL,
      date              TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_timings_cat
      ON memory_task_timings(task_category);

    CREATE TABLE IF NOT EXISTS memory_meta (
      id                 INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      last_reflection_at TEXT,
      reflection_count   INTEGER NOT NULL DEFAULT 0,
      version            INTEGER NOT NULL DEFAULT 1
    );
    INSERT OR IGNORE INTO memory_meta (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS app_store (
      key    TEXT PRIMARY KEY,
      value  TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      start_date      TEXT NOT NULL,
      end_date        TEXT NOT NULL,
      is_all_day      INTEGER NOT NULL DEFAULT 0,
      duration_minutes INTEGER NOT NULL DEFAULT 60,
      category        TEXT NOT NULL DEFAULT 'personal',
      is_vacation     INTEGER NOT NULL DEFAULT 0,
      source          TEXT NOT NULL DEFAULT 'manual',
      source_calendar TEXT,
      color           TEXT,
      notes           TEXT,
      recurring_freq  TEXT,
      recurring_until TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cal_events_date
      ON calendar_events(start_date);

    CREATE TABLE IF NOT EXISTS job_queue (
      id            TEXT PRIMARY KEY,
      type          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      payload       TEXT NOT NULL DEFAULT '{}',
      result        TEXT,
      error         TEXT,
      progress      INTEGER NOT NULL DEFAULT 0,
      progress_log  TEXT NOT NULL DEFAULT '[]',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      started_at    TEXT,
      completed_at  TEXT,
      retry_count   INTEGER NOT NULL DEFAULT 0,
      max_retries   INTEGER NOT NULL DEFAULT 2
    );
    CREATE INDEX IF NOT EXISTS idx_job_queue_status
      ON job_queue(status);
    CREATE INDEX IF NOT EXISTS idx_job_queue_type
      ON job_queue(type);

    CREATE TABLE IF NOT EXISTS monthly_contexts (
      month         TEXT PRIMARY KEY,
      description   TEXT NOT NULL DEFAULT '',
      intensity     TEXT NOT NULL DEFAULT 'normal',
      intensity_reasoning TEXT NOT NULL DEFAULT '',
      capacity_multiplier REAL NOT NULL DEFAULT 1.0,
      max_daily_tasks INTEGER NOT NULL DEFAULT 4,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL DEFAULT 'New chat',
      messages    TEXT NOT NULL DEFAULT '[]',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_attachments (
      id              TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL,
      message_id      TEXT NOT NULL,
      filename        TEXT NOT NULL,
      mime_type       TEXT NOT NULL,
      file_path       TEXT NOT NULL,
      file_type       TEXT NOT NULL DEFAULT 'image',
      size_bytes      INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_chat_attachments_session
      ON chat_attachments (session_id);
    CREATE INDEX IF NOT EXISTS idx_chat_attachments_message
      ON chat_attachments (message_id);

    CREATE TABLE IF NOT EXISTS reminders (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      reminder_time   TEXT NOT NULL,
      date            TEXT NOT NULL,
      acknowledged    INTEGER NOT NULL DEFAULT 0,
      acknowledged_at TEXT,
      repeat          TEXT,
      source          TEXT NOT NULL DEFAULT 'chat',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_reminders_date
      ON reminders(date);
  `);

  console.log("[DB] Migrations complete");
}
