/* ──────────────────────────────────────────────────────────
   NorthStar — SQLite Database Layer (better-sqlite3)

   Embedded database — no external server required.
   Users download the app and everything works out of the box.

   Data location: app.getPath('userData')/northstar.db
   macOS:   ~/Library/Application Support/NorthStar/northstar.db
   Windows: %APPDATA%/NorthStar/northstar.db
   Linux:   ~/.config/NorthStar/northstar.db
   ────────────────────────────────────────────────────────── */

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { app } from "electron";

// ── Database Instance (singleton) ───────────────────────

let db: Database.Database | null = null;

function getDBPath(): string {
  const isDev = !app.isPackaged;
  const userDataPath = isDev
    ? path.join(app.getPath("userData"), "dev-data")
    : app.getPath("userData");
  fs.mkdirSync(userDataPath, { recursive: true });
  return path.join(userDataPath, "northstar.db");
}

export function getDB(): Database.Database {
  if (!db) {
    const dbPath = getDBPath();
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    console.log(`[DB] SQLite opened at ${dbPath}`);
  }
  return db;
}

export async function closePool(): Promise<void> {
  if (db) {
    db.close();
    db = null;
    console.log("[DB] SQLite closed");
  }
}

export async function testConnection(): Promise<boolean> {
  try {
    const d = getDB();
    const row = d.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
    return row?.ok === 1;
  } catch (err) {
    console.error("DB connection test failed:", err);
    return false;
  }
}

// ── Convenience query helpers ───────────────────────────

function convertPgSql(sql: string): string {
  let s = sql;
  s = s.replace(/\$\d+/g, "?");
  s = s.replace(/::\w+/g, "");
  s = s.replace(/NOW\(\)/gi, "datetime('now')");
  return s;
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const d = getDB();
  const stmt = d.prepare(convertPgSql(sql));
  return (params ? stmt.all(...params) : stmt.all()) as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const d = getDB();
  const stmt = d.prepare(convertPgSql(sql));
  const row = params ? stmt.get(...params) : stmt.get();
  return (row as T) ?? null;
}

export async function execute(
  sql: string,
  params?: unknown[]
): Promise<number> {
  const d = getDB();
  const stmt = d.prepare(convertPgSql(sql));
  const result = params ? stmt.run(...params) : stmt.run();
  return result.changes;
}

export async function transaction<T>(
  fn: (db: Database.Database) => T
): Promise<T> {
  const d = getDB();
  const txn = d.transaction(() => fn(d));
  return txn();
}

// ── Schema Migration ────────────────────────────────────

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

// ── App Store ───────────────────────────────────────────

export async function loadAppData(): Promise<Record<string, unknown>> {
  const d = getDB();
  const rows = d.prepare("SELECT key, value FROM app_store").all() as Array<{ key: string; value: string }>;
  const data: Record<string, unknown> = {};
  for (const row of rows) {
    try { data[row.key] = JSON.parse(row.value); } catch { data[row.key] = row.value; }
  }
  return data;
}

export async function saveAppData(data: Record<string, unknown>): Promise<void> {
  const d = getDB();
  const upsert = d.prepare(
    `INSERT INTO app_store (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`
  );
  const saveTxn = d.transaction(() => {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      upsert.run(key, JSON.stringify(value));
    }
  });
  saveTxn();
}

// ── Calendar Events ─────────────────────────────────────

export interface DBCalendarEvent {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  is_all_day: boolean | number;
  duration_minutes: number;
  category: string;
  is_vacation: boolean | number;
  source: string;
  source_calendar: string | null;
  color: string | null;
  notes: string | null;
  recurring_freq: string | null;
  recurring_until: string | null;
}

function normalizeEvent(row: DBCalendarEvent): DBCalendarEvent {
  return { ...row, is_all_day: !!row.is_all_day, is_vacation: !!row.is_vacation };
}

export async function getAllCalendarEvents(): Promise<DBCalendarEvent[]> {
  const d = getDB();
  const rows = d.prepare("SELECT * FROM calendar_events ORDER BY start_date").all() as DBCalendarEvent[];
  return rows.map(normalizeEvent);
}

export async function getCalendarEventsByRange(
  startDate: string,
  endDate: string
): Promise<DBCalendarEvent[]> {
  const d = getDB();
  const rows = d.prepare(
    "SELECT * FROM calendar_events WHERE start_date >= ? AND start_date <= ? ORDER BY start_date"
  ).all(startDate, endDate) as DBCalendarEvent[];
  return rows.map(normalizeEvent);
}

export async function upsertCalendarEvent(event: {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  isAllDay: boolean;
  durationMinutes: number;
  category: string;
  isVacation: boolean;
  source: string;
  sourceCalendar?: string;
  color?: string;
  notes?: string;
  recurringFreq?: string;
  recurringUntil?: string;
}): Promise<void> {
  const d = getDB();
  d.prepare(
    `INSERT INTO calendar_events
       (id, title, start_date, end_date, is_all_day, duration_minutes,
        category, is_vacation, source, source_calendar, color, notes,
        recurring_freq, recurring_until)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       title=excluded.title, start_date=excluded.start_date,
       end_date=excluded.end_date, is_all_day=excluded.is_all_day,
       duration_minutes=excluded.duration_minutes,
       category=excluded.category, is_vacation=excluded.is_vacation,
       source=excluded.source, source_calendar=excluded.source_calendar,
       color=excluded.color, notes=excluded.notes,
       recurring_freq=excluded.recurring_freq,
       recurring_until=excluded.recurring_until,
       updated_at=datetime('now')`
  ).run(
    event.id, event.title, event.startDate, event.endDate,
    event.isAllDay ? 1 : 0, event.durationMinutes, event.category,
    event.isVacation ? 1 : 0, event.source, event.sourceCalendar || null,
    event.color || null, event.notes || null,
    event.recurringFreq || null, event.recurringUntil || null
  );
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  const d = getDB();
  d.prepare("DELETE FROM calendar_events WHERE id = ?").run(id);
}

// ── Reminders ───────────────────────────────────────────

export interface DBReminder {
  id: string;
  title: string;
  description: string;
  reminder_time: string;
  date: string;
  acknowledged: number;
  acknowledged_at: string | null;
  repeat: string | null;
  source: string;
  created_at: string;
}

export async function getAllReminders(): Promise<DBReminder[]> {
  const d = getDB();
  return d.prepare("SELECT * FROM reminders ORDER BY reminder_time").all() as DBReminder[];
}

export async function getRemindersByDate(date: string): Promise<DBReminder[]> {
  const d = getDB();
  return d.prepare("SELECT * FROM reminders WHERE date = ? ORDER BY reminder_time").all(date) as DBReminder[];
}

export async function upsertReminder(r: {
  id: string;
  title: string;
  description: string;
  reminderTime: string;
  date: string;
  acknowledged: boolean;
  repeat: string | null;
  source: string;
}): Promise<void> {
  const d = getDB();
  d.prepare(
    `INSERT INTO reminders (id, title, description, reminder_time, date, acknowledged, repeat, source)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       title=excluded.title, description=excluded.description,
       reminder_time=excluded.reminder_time, date=excluded.date,
       acknowledged=excluded.acknowledged, repeat=excluded.repeat,
       source=excluded.source`
  ).run(r.id, r.title, r.description, r.reminderTime, r.date, r.acknowledged ? 1 : 0, r.repeat, r.source);
}

export async function acknowledgeReminder(id: string): Promise<void> {
  const d = getDB();
  d.prepare(
    "UPDATE reminders SET acknowledged = 1, acknowledged_at = datetime('now') WHERE id = ?"
  ).run(id);
}

export async function deleteReminder(id: string): Promise<void> {
  const d = getDB();
  d.prepare("DELETE FROM reminders WHERE id = ?").run(id);
}

// ── Memory DB Operations ────────────────────────────────

export async function loadMemoryFromDB(): Promise<{
  facts: Record<string, unknown>[];
  preferences: Record<string, unknown>[];
  signals: Record<string, unknown>[];
  snoozeRecords: Record<string, unknown>[];
  taskTimings: Record<string, unknown>[];
  lastReflectionAt: string | null;
  reflectionCount: number;
}> {
  const d = getDB();

  const facts = d.prepare("SELECT * FROM memory_facts ORDER BY updated_at DESC").all() as Record<string, unknown>[];
  const preferences = d.prepare("SELECT * FROM memory_preferences ORDER BY updated_at DESC").all() as Record<string, unknown>[];
  const signals = d.prepare("SELECT * FROM memory_signals ORDER BY timestamp DESC LIMIT 500").all() as Record<string, unknown>[];
  const snoozeRecords = d.prepare("SELECT * FROM memory_snooze_records ORDER BY last_snoozed DESC LIMIT 100").all() as Record<string, unknown>[];
  const taskTimings = d.prepare("SELECT * FROM memory_task_timings ORDER BY date DESC LIMIT 200").all() as Record<string, unknown>[];
  const meta = d.prepare("SELECT last_reflection_at, reflection_count FROM memory_meta WHERE id = 1").get() as {
    last_reflection_at: string | null;
    reflection_count: number;
  } | undefined;

  for (const fact of facts) {
    if (typeof fact.evidence === "string") {
      try { fact.evidence = JSON.parse(fact.evidence as string); } catch { fact.evidence = []; }
    }
  }
  for (const pref of preferences) {
    if (typeof pref.tags === "string") {
      try { pref.tags = JSON.parse(pref.tags as string); } catch { pref.tags = []; }
    }
    if (typeof pref.examples === "string") {
      try { pref.examples = JSON.parse(pref.examples as string); } catch { pref.examples = []; }
    }
  }
  for (const timing of taskTimings) {
    if (typeof timing.task_keywords === "string") {
      try { timing.task_keywords = JSON.parse(timing.task_keywords as string); } catch { timing.task_keywords = []; }
    }
  }

  return {
    facts,
    preferences,
    signals,
    snoozeRecords,
    taskTimings,
    lastReflectionAt: meta?.last_reflection_at || null,
    reflectionCount: meta?.reflection_count || 0,
  };
}

export async function dbUpsertFact(
  id: string,
  category: string,
  key: string,
  value: string,
  confidence: number,
  evidence: string[],
  source: string
): Promise<void> {
  const d = getDB();
  d.prepare(
    `INSERT INTO memory_facts (id, category, key, value, confidence, evidence, source)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       value=excluded.value, confidence=excluded.confidence,
       evidence=excluded.evidence, source=excluded.source,
       updated_at=datetime('now')`
  ).run(id, category, key, value, confidence, JSON.stringify(evidence), source);
}

export async function dbUpsertPreference(
  id: string,
  text: string,
  tags: string[],
  weight: number,
  frequency: number,
  examples: string[]
): Promise<void> {
  const d = getDB();
  d.prepare(
    `INSERT INTO memory_preferences (id, text, tags, weight, frequency, examples)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       text=excluded.text, tags=excluded.tags, weight=excluded.weight,
       frequency=excluded.frequency, examples=excluded.examples,
       updated_at=datetime('now')`
  ).run(id, text, JSON.stringify(tags), weight, frequency, JSON.stringify(examples));
}

export async function dbInsertSignal(
  id: string,
  type: string,
  context: string,
  value: string
): Promise<void> {
  const d = getDB();
  d.prepare(
    "INSERT INTO memory_signals (id, type, context, value) VALUES (?,?,?,?)"
  ).run(id, type, context, value);
  d.prepare(
    "DELETE FROM memory_signals WHERE id IN (SELECT id FROM memory_signals ORDER BY timestamp DESC LIMIT -1 OFFSET 500)"
  ).run();
}

export async function dbUpsertSnooze(
  taskTitle: string,
  taskCategory: string,
  originalDate: string
): Promise<void> {
  const d = getDB();
  d.prepare(
    `INSERT INTO memory_snooze_records (task_title, task_category, snooze_count, original_date)
     VALUES (?,?,1,?)
     ON CONFLICT (task_title, original_date) DO UPDATE SET
       snooze_count = memory_snooze_records.snooze_count + 1,
       last_snoozed = datetime('now')`
  ).run(taskTitle, taskCategory, originalDate);
}

export async function dbInsertTaskTiming(
  taskCategory: string,
  taskKeywords: string[],
  estimatedMinutes: number,
  actualMinutes: number,
  date: string
): Promise<void> {
  const d = getDB();
  d.prepare(
    "INSERT INTO memory_task_timings (task_category, task_keywords, estimated_minutes, actual_minutes, date) VALUES (?,?,?,?,?)"
  ).run(taskCategory, JSON.stringify(taskKeywords), estimatedMinutes, actualMinutes, date);
  d.prepare(
    "DELETE FROM memory_task_timings WHERE id IN (SELECT id FROM memory_task_timings ORDER BY date DESC LIMIT -1 OFFSET 200)"
  ).run();
}

export async function dbUpdateReflectionMeta(
  lastReflectionAt: string,
  reflectionCount: number
): Promise<void> {
  const d = getDB();
  d.prepare(
    "UPDATE memory_meta SET last_reflection_at=?, reflection_count=? WHERE id=1"
  ).run(lastReflectionAt, reflectionCount);
}

export async function dbClearMemory(): Promise<void> {
  const d = getDB();
  d.exec(`
    DELETE FROM memory_facts;
    DELETE FROM memory_preferences;
    DELETE FROM memory_signals;
    DELETE FROM memory_snooze_records;
    DELETE FROM memory_task_timings;
    UPDATE memory_meta SET last_reflection_at=NULL, reflection_count=0 WHERE id=1;
  `);
}

// ── Monthly Context ────────────────────────────────────

export interface DBMonthlyContext {
  month: string;
  description: string;
  intensity: string;
  intensity_reasoning: string;
  capacity_multiplier: number;
  max_daily_tasks: number;
  updated_at: string;
}

export async function getAllMonthlyContexts(): Promise<DBMonthlyContext[]> {
  const d = getDB();
  return d.prepare("SELECT * FROM monthly_contexts ORDER BY month DESC").all() as DBMonthlyContext[];
}

export async function getMonthlyContext(month: string): Promise<DBMonthlyContext | null> {
  const d = getDB();
  const row = d.prepare("SELECT * FROM monthly_contexts WHERE month = ?").get(month) as DBMonthlyContext | undefined;
  return row ?? null;
}

export async function upsertMonthlyContext(ctx: {
  month: string;
  description: string;
  intensity: string;
  intensityReasoning: string;
  capacityMultiplier: number;
  maxDailyTasks: number;
}): Promise<void> {
  const d = getDB();
  d.prepare(
    `INSERT INTO monthly_contexts (month, description, intensity, intensity_reasoning, capacity_multiplier, max_daily_tasks, updated_at)
     VALUES (?,?,?,?,?,?,datetime('now'))
     ON CONFLICT (month) DO UPDATE SET
       description=excluded.description, intensity=excluded.intensity,
       intensity_reasoning=excluded.intensity_reasoning,
       capacity_multiplier=excluded.capacity_multiplier,
       max_daily_tasks=excluded.max_daily_tasks,
       updated_at=datetime('now')`
  ).run(ctx.month, ctx.description, ctx.intensity, ctx.intensityReasoning, ctx.capacityMultiplier, ctx.maxDailyTasks);
}

export async function deleteMonthlyContext(month: string): Promise<void> {
  const d = getDB();
  d.prepare("DELETE FROM monthly_contexts WHERE month = ?").run(month);
}

// ── Semantic Search (local vector similarity) ───────────

export function generateTagEmbedding(tags: string[], text: string): number[] {
  const dim = 64;
  const vec = new Array(dim).fill(0);
  const tokens = [
    ...tags.map((t) => t.toLowerCase()),
    ...text.toLowerCase().split(/\s+/).filter((w) => w.length > 2),
  ];
  for (const token of tokens) {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % dim;
    vec[idx] += hash > 0 ? 1 : -1;
  }
  const norm = Math.sqrt(vec.reduce((sum: number, v: number) => sum + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < dim; i++) vec[i] /= norm;
  }
  return vec;
}

export async function ensureVectorColumn(): Promise<void> {
  console.log("[DB] SQLite semantic search ready (local cosine similarity)");
}

export async function dbUpsertPreferenceWithEmbedding(
  id: string,
  text: string,
  tags: string[],
  weight: number,
  frequency: number,
  examples: string[]
): Promise<void> {
  const embedding = generateTagEmbedding(tags, text);
  const d = getDB();
  d.prepare(
    `INSERT INTO memory_preferences (id, text, tags, weight, frequency, examples, embedding)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       text=excluded.text, tags=excluded.tags, weight=excluded.weight,
       frequency=excluded.frequency, examples=excluded.examples,
       embedding=excluded.embedding, updated_at=datetime('now')`
  ).run(id, text, JSON.stringify(tags), weight, frequency, JSON.stringify(examples), JSON.stringify(embedding));
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export async function searchSimilarPreferences(
  queryTags: string[],
  queryText: string,
  limit: number = 10
): Promise<Array<{
  id: string;
  text: string;
  tags: string[];
  weight: number;
  frequency: number;
  similarity: number;
}>> {
  const queryEmbedding = generateTagEmbedding(queryTags, queryText);
  const d = getDB();
  const rows = d.prepare(
    "SELECT id, text, tags, weight, frequency, embedding FROM memory_preferences WHERE embedding IS NOT NULL"
  ).all() as Array<{
    id: string; text: string; tags: string; weight: number; frequency: number; embedding: string;
  }>;

  const scored = rows
    .map((row) => {
      let tags: string[];
      try { tags = JSON.parse(row.tags); } catch { tags = []; }
      let embedding: number[];
      try { embedding = JSON.parse(row.embedding); } catch { return null; }
      return {
        id: row.id, text: row.text, tags, weight: row.weight,
        frequency: row.frequency, similarity: cosineSimilarity(queryEmbedding, embedding),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return scored;
}

export async function backfillPreferenceEmbeddings(): Promise<number> {
  const d = getDB();
  const prefs = d.prepare(
    "SELECT id, text, tags FROM memory_preferences WHERE embedding IS NULL"
  ).all() as Array<{ id: string; text: string; tags: string }>;

  let count = 0;
  const update = d.prepare("UPDATE memory_preferences SET embedding = ? WHERE id = ?");
  const txn = d.transaction(() => {
    for (const pref of prefs) {
      let tags: string[];
      try { tags = JSON.parse(pref.tags); } catch { tags = []; }
      const embedding = generateTagEmbedding(tags, pref.text);
      update.run(JSON.stringify(embedding), pref.id);
      count++;
    }
  });
  txn();
  return count;
}

// ── Chat Sessions ──────────────────────────────────────

export interface DBChatSession {
  id: string;
  title: string;
  messages: string; // JSON array
  created_at: string;
  updated_at: string;
}

export interface DBChatAttachment {
  id: string;
  session_id: string;
  message_id: string;
  filename: string;
  mime_type: string;
  file_path: string;
  file_type: string;
  size_bytes: number;
  created_at: string;
}

export function getAllChatSessions(): DBChatSession[] {
  const d = getDB();
  return d.prepare("SELECT * FROM chat_sessions ORDER BY updated_at DESC").all() as DBChatSession[];
}

export function upsertChatSession(session: {
  id: string;
  title: string;
  messages: string;
  createdAt: string;
  updatedAt: string;
}): void {
  const d = getDB();
  d.prepare(
    `INSERT INTO chat_sessions (id, title, messages, created_at, updated_at)
     VALUES (?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       title=excluded.title, messages=excluded.messages,
       updated_at=excluded.updated_at`
  ).run(session.id, session.title, session.messages, session.createdAt, session.updatedAt);
}

export function deleteChatSession(id: string): void {
  const d = getDB();
  d.prepare("DELETE FROM chat_sessions WHERE id = ?").run(id);
  d.prepare("DELETE FROM chat_attachments WHERE session_id = ?").run(id);
}

export function insertChatAttachment(att: {
  id: string;
  sessionId: string;
  messageId: string;
  filename: string;
  mimeType: string;
  filePath: string;
  fileType: string;
  sizeBytes: number;
}): void {
  const d = getDB();
  d.prepare(
    `INSERT INTO chat_attachments (id, session_id, message_id, filename, mime_type, file_path, file_type, size_bytes)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(att.id, att.sessionId, att.messageId, att.filename, att.mimeType, att.filePath, att.fileType, att.sizeBytes);
}

export function getAttachmentsForSession(sessionId: string): DBChatAttachment[] {
  const d = getDB();
  return d.prepare(
    "SELECT * FROM chat_attachments WHERE session_id = ? ORDER BY created_at"
  ).all(sessionId) as DBChatAttachment[];
}

export function getAttachmentsDir(): string {
  const isDev = !app.isPackaged;
  const base = isDev
    ? path.join(app.getPath("userData"), "dev-data")
    : app.getPath("userData");
  const dir = path.join(base, "attachments");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
