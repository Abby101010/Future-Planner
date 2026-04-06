/* ──────────────────────────────────────────────────────────
   NorthStar — PostgreSQL Database Layer
   
   All app data flows through here. No more JSON files.
   Uses the `pg` driver directly (no ORM overhead).
   
   Connection: localhost:5432 / life_planner
   Management UI: Adminer (adminer/index.php)
   ────────────────────────────────────────────────────────── */

import { Pool, type PoolClient } from "pg";

// ── Connection Pool (singleton) ─────────────────────────

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.PGHOST || "localhost",
      port: parseInt(process.env.PGPORT || "5432", 10),
      database: process.env.PGDATABASE || "life_planner",
      user: process.env.PGUSER || process.env.USER || "postgres",
      password: process.env.PGPASSWORD || "",
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    pool.on("error", (err) => {
      console.error("Unexpected PG pool error:", err);
    });
  }
  return pool;
}

/** Shut down the pool cleanly (call on app quit) */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Test that we can reach Postgres */
export async function testConnection(): Promise<boolean> {
  try {
    const p = getPool();
    const res = await p.query("SELECT 1 AS ok");
    return res.rows[0]?.ok === 1;
  } catch (err) {
    console.error("DB connection test failed:", err);
    return false;
  }
}

// ── Convenience query helpers ───────────────────────────

/** Run a single query and return rows */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const p = getPool();
  const res = await p.query(sql, params);
  return res.rows as T[];
}

/** Run a single query and return the first row or null */
export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** Run an INSERT/UPDATE/DELETE and return affected row count */
export async function execute(
  sql: string,
  params?: unknown[]
): Promise<number> {
  const p = getPool();
  const res = await p.query(sql, params);
  return res.rowCount ?? 0;
}

/** Run multiple statements in a transaction */
export async function transaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── Schema Migration ────────────────────────────────────
// Ensures our memory tables exist alongside the original schema.
// Safe to call multiple times (uses IF NOT EXISTS).

export async function runMigrations(): Promise<void> {
  const p = getPool();

  await p.query(`
    -- Memory facts (Layer 2: Long-term structured facts)
    CREATE TABLE IF NOT EXISTS memory_facts (
      id            TEXT PRIMARY KEY,
      category      TEXT NOT NULL,
      key           TEXT NOT NULL,
      value         TEXT NOT NULL,
      confidence    REAL NOT NULL DEFAULT 0.3,
      evidence      TEXT[] NOT NULL DEFAULT '{}',
      source        TEXT NOT NULL DEFAULT 'reflection',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_memory_facts_cat_key
      ON memory_facts(category, key);

    -- Memory preferences (Layer 3: Semantic preferences)
    CREATE TABLE IF NOT EXISTS memory_preferences (
      id            TEXT PRIMARY KEY,
      text          TEXT NOT NULL,
      tags          TEXT[] NOT NULL DEFAULT '{}',
      weight        REAL NOT NULL DEFAULT 0,
      frequency     INT NOT NULL DEFAULT 1,
      examples      TEXT[] NOT NULL DEFAULT '{}',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_memory_prefs_tags
      ON memory_preferences USING GIN(tags);

    -- Behavioral signals
    CREATE TABLE IF NOT EXISTS memory_signals (
      id            TEXT PRIMARY KEY,
      type          TEXT NOT NULL,
      context       TEXT NOT NULL,
      value         TEXT NOT NULL,
      timestamp     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_memory_signals_type
      ON memory_signals(type);
    CREATE INDEX IF NOT EXISTS idx_memory_signals_ts
      ON memory_signals(timestamp DESC);

    -- Snooze records
    CREATE TABLE IF NOT EXISTS memory_snooze_records (
      id            SERIAL PRIMARY KEY,
      task_title    TEXT NOT NULL,
      task_category TEXT NOT NULL,
      snooze_count  INT NOT NULL DEFAULT 1,
      original_date TEXT NOT NULL,
      last_snoozed  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(task_title, original_date)
    );

    -- Task timing records
    CREATE TABLE IF NOT EXISTS memory_task_timings (
      id                SERIAL PRIMARY KEY,
      task_category     TEXT NOT NULL,
      task_keywords     TEXT[] NOT NULL DEFAULT '{}',
      estimated_minutes INT NOT NULL,
      actual_minutes    INT NOT NULL,
      date              TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_timings_cat
      ON memory_task_timings(task_category);

    -- Memory meta (single row)
    CREATE TABLE IF NOT EXISTS memory_meta (
      id                 INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      last_reflection_at TIMESTAMPTZ,
      reflection_count   INT NOT NULL DEFAULT 0,
      version            INT NOT NULL DEFAULT 1
    );
    INSERT INTO memory_meta (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

    -- App store (replaces northstar-data.json)
    CREATE TABLE IF NOT EXISTS app_store (
      key    TEXT PRIMARY KEY,
      value  JSONB NOT NULL DEFAULT '{}'
    );

    -- Calendar events (standalone, not macOS-dependent)
    CREATE TABLE IF NOT EXISTS calendar_events (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      start_date      TIMESTAMPTZ NOT NULL,
      end_date        TIMESTAMPTZ NOT NULL,
      is_all_day      BOOLEAN NOT NULL DEFAULT FALSE,
      duration_minutes INT NOT NULL DEFAULT 60,
      category        TEXT NOT NULL DEFAULT 'personal',
      is_vacation     BOOLEAN NOT NULL DEFAULT FALSE,
      source          TEXT NOT NULL DEFAULT 'manual',
      source_calendar TEXT,
      color           TEXT,
      notes           TEXT,
      recurring_freq  TEXT,
      recurring_until TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_cal_events_date
      ON calendar_events(start_date);
  `);

  console.log("[DB] Migrations complete");
}

// ── App Store (replaces JSON file) ──────────────────────

export async function loadAppData(): Promise<Record<string, unknown>> {
  const rows = await query<{ key: string; value: unknown }>(
    "SELECT key, value FROM app_store"
  );
  const data: Record<string, unknown> = {};
  for (const row of rows) {
    data[row.key] = row.value;
  }
  return data;
}

export async function saveAppData(data: Record<string, unknown>): Promise<void> {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      await client.query(
        `INSERT INTO app_store (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2`,
        [key, JSON.stringify(value)]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── Calendar Events (standalone DB-backed) ──────────────

export interface DBCalendarEvent {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
  is_all_day: boolean;
  duration_minutes: number;
  category: string;
  is_vacation: boolean;
  source: string;
  source_calendar: string | null;
  color: string | null;
  notes: string | null;
  recurring_freq: string | null;
  recurring_until: string | null;
}

export async function getAllCalendarEvents(): Promise<DBCalendarEvent[]> {
  return query<DBCalendarEvent>(
    "SELECT * FROM calendar_events ORDER BY start_date"
  );
}

export async function getCalendarEventsByRange(
  startDate: string,
  endDate: string
): Promise<DBCalendarEvent[]> {
  return query<DBCalendarEvent>(
    `SELECT * FROM calendar_events
     WHERE start_date >= $1 AND start_date <= $2
     ORDER BY start_date`,
    [startDate, endDate]
  );
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
  await execute(
    `INSERT INTO calendar_events
       (id, title, start_date, end_date, is_all_day, duration_minutes,
        category, is_vacation, source, source_calendar, color, notes,
        recurring_freq, recurring_until)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (id) DO UPDATE SET
       title=$2, start_date=$3, end_date=$4, is_all_day=$5,
       duration_minutes=$6, category=$7, is_vacation=$8,
       source=$9, source_calendar=$10, color=$11, notes=$12,
       recurring_freq=$13, recurring_until=$14,
       updated_at=NOW()`,
    [
      event.id, event.title, event.startDate, event.endDate,
      event.isAllDay, event.durationMinutes, event.category,
      event.isVacation, event.source, event.sourceCalendar || null,
      event.color || null, event.notes || null,
      event.recurringFreq || null, event.recurringUntil || null,
    ]
  );
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  await execute("DELETE FROM calendar_events WHERE id = $1", [id]);
}

// ── Memory DB Operations ────────────────────────────────
// These mirror the MemoryStore shape but read/write from PG.

export async function loadMemoryFromDB(): Promise<{
  facts: Record<string, unknown>[];
  preferences: Record<string, unknown>[];
  signals: Record<string, unknown>[];
  snoozeRecords: Record<string, unknown>[];
  taskTimings: Record<string, unknown>[];
  lastReflectionAt: string | null;
  reflectionCount: number;
}> {
  const [facts, preferences, signals, snoozeRecords, taskTimings, meta] =
    await Promise.all([
      query("SELECT * FROM memory_facts ORDER BY updated_at DESC"),
      query("SELECT * FROM memory_preferences ORDER BY updated_at DESC"),
      query("SELECT * FROM memory_signals ORDER BY timestamp DESC LIMIT 500"),
      query("SELECT * FROM memory_snooze_records ORDER BY last_snoozed DESC LIMIT 100"),
      query("SELECT * FROM memory_task_timings ORDER BY date DESC LIMIT 200"),
      queryOne<{ last_reflection_at: string | null; reflection_count: number }>(
        "SELECT last_reflection_at, reflection_count FROM memory_meta WHERE id = 1"
      ),
    ]);

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
  await execute(
    `INSERT INTO memory_facts (id, category, key, value, confidence, evidence, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET
       value=$4, confidence=$5, evidence=$6, source=$7, updated_at=NOW()`,
    [id, category, key, value, confidence, evidence, source]
  );
}

export async function dbUpsertPreference(
  id: string,
  text: string,
  tags: string[],
  weight: number,
  frequency: number,
  examples: string[]
): Promise<void> {
  await execute(
    `INSERT INTO memory_preferences (id, text, tags, weight, frequency, examples)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (id) DO UPDATE SET
       text=$2, tags=$3, weight=$4, frequency=$5, examples=$6, updated_at=NOW()`,
    [id, text, tags, weight, frequency, examples]
  );
}

export async function dbInsertSignal(
  id: string,
  type: string,
  context: string,
  value: string
): Promise<void> {
  await execute(
    `INSERT INTO memory_signals (id, type, context, value) VALUES ($1,$2,$3,$4)`,
    [id, type, context, value]
  );
  // Trim to 500
  await execute(
    `DELETE FROM memory_signals WHERE id IN (
       SELECT id FROM memory_signals ORDER BY timestamp DESC OFFSET 500
     )`
  );
}

export async function dbUpsertSnooze(
  taskTitle: string,
  taskCategory: string,
  originalDate: string
): Promise<void> {
  await execute(
    `INSERT INTO memory_snooze_records (task_title, task_category, snooze_count, original_date)
     VALUES ($1,$2,1,$3)
     ON CONFLICT (task_title, original_date) DO UPDATE SET
       snooze_count = memory_snooze_records.snooze_count + 1,
       last_snoozed = NOW()`,
    [taskTitle, taskCategory, originalDate]
  );
}

export async function dbInsertTaskTiming(
  taskCategory: string,
  taskKeywords: string[],
  estimatedMinutes: number,
  actualMinutes: number,
  date: string
): Promise<void> {
  await execute(
    `INSERT INTO memory_task_timings (task_category, task_keywords, estimated_minutes, actual_minutes, date)
     VALUES ($1,$2,$3,$4,$5)`,
    [taskCategory, taskKeywords, estimatedMinutes, actualMinutes, date]
  );
  // Trim to 200
  await execute(
    `DELETE FROM memory_task_timings WHERE id IN (
       SELECT id FROM memory_task_timings ORDER BY date DESC OFFSET 200
     )`
  );
}

export async function dbUpdateReflectionMeta(
  lastReflectionAt: string,
  reflectionCount: number
): Promise<void> {
  await execute(
    `UPDATE memory_meta SET last_reflection_at=$1, reflection_count=$2 WHERE id=1`,
    [lastReflectionAt, reflectionCount]
  );
}

export async function dbClearMemory(): Promise<void> {
  const p = getPool();
  await p.query(`
    TRUNCATE memory_facts, memory_preferences, memory_signals,
             memory_snooze_records, memory_task_timings;
    UPDATE memory_meta SET last_reflection_at=NULL, reflection_count=0 WHERE id=1;
  `);
}

// ── pgvector Semantic Search ────────────────────────────
//
// Uses PostgreSQL's pgvector extension (already enabled in schema.sql)
// for preference vector storage and similarity search.
//
// This replaces the need for Pinecone — everything stays local in PG.
// Embeddings are generated via a simple tag-based TF-IDF-like approach
// for preferences, or can be swapped for real LLM embeddings later.

/**
 * Generate a lightweight pseudo-embedding from tags + text.
 * This is a 64-dimensional hashed vector — fast, local, no API call.
 * Good enough for ~1000 preferences. Swap for real embeddings later.
 */
export function generateTagEmbedding(tags: string[], text: string): number[] {
  const dim = 64;
  const vec = new Array(dim).fill(0);
  const tokens = [
    ...tags.map((t) => t.toLowerCase()),
    ...text.toLowerCase().split(/\s+/).filter((w) => w.length > 2),
  ];

  for (const token of tokens) {
    // Deterministic hash to spread tokens across dimensions
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = ((hash << 5) - hash + token.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % dim;
    vec[idx] += hash > 0 ? 1 : -1;
  }

  // L2 normalize
  const norm = Math.sqrt(vec.reduce((sum: number, v: number) => sum + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < dim; i++) vec[i] /= norm;
  }
  return vec;
}

/**
 * Add the embedding column to memory_preferences if not present.
 * Safe to call multiple times.
 */
export async function ensureVectorColumn(): Promise<void> {
  const p = getPool();
  try {
    // Check if pgvector extension is available
    const extCheck = await p.query(
      `SELECT 1 FROM pg_extension WHERE extname = 'vector'`
    );
    if (extCheck.rows.length === 0) {
      // Try to create it
      try {
        await p.query(`CREATE EXTENSION IF NOT EXISTS vector`);
      } catch {
        console.warn("[DB] pgvector extension not available — semantic search disabled");
        return;
      }
    }

    // Add embedding column if missing
    await p.query(`
      ALTER TABLE memory_preferences
      ADD COLUMN IF NOT EXISTS embedding vector(64)
    `);

    // Create HNSW index for fast similarity search
    await p.query(`
      CREATE INDEX IF NOT EXISTS idx_memory_prefs_embedding
      ON memory_preferences USING hnsw (embedding vector_cosine_ops)
    `);

    console.log("[DB] pgvector semantic search ready");
  } catch (err) {
    console.warn("[DB] Vector column setup failed (non-fatal):", err);
  }
}

/**
 * Upsert a preference WITH its embedding vector.
 */
export async function dbUpsertPreferenceWithEmbedding(
  id: string,
  text: string,
  tags: string[],
  weight: number,
  frequency: number,
  examples: string[]
): Promise<void> {
  const embedding = generateTagEmbedding(tags, text);
  const embeddingStr = `[${embedding.join(",")}]`;

  await execute(
    `INSERT INTO memory_preferences (id, text, tags, weight, frequency, examples, embedding)
     VALUES ($1,$2,$3,$4,$5,$6,$7::vector)
     ON CONFLICT (id) DO UPDATE SET
       text=$2, tags=$3, weight=$4, frequency=$5, examples=$6,
       embedding=$7::vector, updated_at=NOW()`,
    [id, text, tags, weight, frequency, examples, embeddingStr]
  );
}

/**
 * Find the most similar preferences to a query using pgvector cosine similarity.
 * Returns preferences ordered by relevance.
 */
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
  const embedding = generateTagEmbedding(queryTags, queryText);
  const embeddingStr = `[${embedding.join(",")}]`;

  try {
    const rows = await query<{
      id: string;
      text: string;
      tags: string[];
      weight: number;
      frequency: number;
      similarity: number;
    }>(
      `SELECT id, text, tags, weight, frequency,
              1 - (embedding <=> $1::vector) AS similarity
       FROM memory_preferences
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [embeddingStr, limit]
    );
    return rows;
  } catch {
    // Fallback: pgvector not available, use tag-based matching
    return [];
  }
}

/**
 * Backfill embeddings for existing preferences that don't have one.
 */
export async function backfillPreferenceEmbeddings(): Promise<number> {
  const prefs = await query<{ id: string; text: string; tags: string[] }>(
    `SELECT id, text, tags FROM memory_preferences WHERE embedding IS NULL`
  );

  let count = 0;
  for (const pref of prefs) {
    const embedding = generateTagEmbedding(pref.tags, pref.text);
    const embeddingStr = `[${embedding.join(",")}]`;
    await execute(
      `UPDATE memory_preferences SET embedding = $1::vector WHERE id = $2`,
      [embeddingStr, pref.id]
    );
    count++;
  }

  return count;
}
