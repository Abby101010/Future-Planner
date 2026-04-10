/* NorthStar — memory_* tables (facts, preferences, signals, snoozes, timings, meta) */

import { getDB } from "./connection";

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

  const facts = d
    .prepare("SELECT * FROM memory_facts ORDER BY updated_at DESC")
    .all() as Record<string, unknown>[];
  const preferences = d
    .prepare("SELECT * FROM memory_preferences ORDER BY updated_at DESC")
    .all() as Record<string, unknown>[];
  const signals = d
    .prepare("SELECT * FROM memory_signals ORDER BY timestamp DESC LIMIT 500")
    .all() as Record<string, unknown>[];
  const snoozeRecords = d
    .prepare(
      "SELECT * FROM memory_snooze_records ORDER BY last_snoozed DESC LIMIT 100",
    )
    .all() as Record<string, unknown>[];
  const taskTimings = d
    .prepare(
      "SELECT * FROM memory_task_timings ORDER BY date DESC LIMIT 200",
    )
    .all() as Record<string, unknown>[];
  const meta = d
    .prepare(
      "SELECT last_reflection_at, reflection_count FROM memory_meta WHERE id = 1",
    )
    .get() as
    | { last_reflection_at: string | null; reflection_count: number }
    | undefined;

  for (const fact of facts) {
    if (typeof fact.evidence === "string") {
      try {
        fact.evidence = JSON.parse(fact.evidence as string);
      } catch {
        fact.evidence = [];
      }
    }
  }
  for (const pref of preferences) {
    if (typeof pref.tags === "string") {
      try {
        pref.tags = JSON.parse(pref.tags as string);
      } catch {
        pref.tags = [];
      }
    }
    if (typeof pref.examples === "string") {
      try {
        pref.examples = JSON.parse(pref.examples as string);
      } catch {
        pref.examples = [];
      }
    }
  }
  for (const timing of taskTimings) {
    if (typeof timing.task_keywords === "string") {
      try {
        timing.task_keywords = JSON.parse(timing.task_keywords as string);
      } catch {
        timing.task_keywords = [];
      }
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
  source: string,
): Promise<void> {
  const d = getDB();
  d.prepare(
    `INSERT INTO memory_facts (id, category, key, value, confidence, evidence, source)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       value=excluded.value, confidence=excluded.confidence,
       evidence=excluded.evidence, source=excluded.source,
       updated_at=datetime('now')`,
  ).run(id, category, key, value, confidence, JSON.stringify(evidence), source);
}

export async function dbUpsertPreference(
  id: string,
  text: string,
  tags: string[],
  weight: number,
  frequency: number,
  examples: string[],
): Promise<void> {
  const d = getDB();
  d.prepare(
    `INSERT INTO memory_preferences (id, text, tags, weight, frequency, examples)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT (id) DO UPDATE SET
       text=excluded.text, tags=excluded.tags, weight=excluded.weight,
       frequency=excluded.frequency, examples=excluded.examples,
       updated_at=datetime('now')`,
  ).run(
    id,
    text,
    JSON.stringify(tags),
    weight,
    frequency,
    JSON.stringify(examples),
  );
}

export async function dbInsertSignal(
  id: string,
  type: string,
  context: string,
  value: string,
): Promise<void> {
  const d = getDB();
  d.prepare(
    "INSERT INTO memory_signals (id, type, context, value) VALUES (?,?,?,?)",
  ).run(id, type, context, value);
  d.prepare(
    "DELETE FROM memory_signals WHERE id IN (SELECT id FROM memory_signals ORDER BY timestamp DESC LIMIT -1 OFFSET 500)",
  ).run();
}

export async function dbUpsertSnooze(
  taskTitle: string,
  taskCategory: string,
  originalDate: string,
): Promise<void> {
  const d = getDB();
  d.prepare(
    `INSERT INTO memory_snooze_records (task_title, task_category, snooze_count, original_date)
     VALUES (?,?,1,?)
     ON CONFLICT (task_title, original_date) DO UPDATE SET
       snooze_count = memory_snooze_records.snooze_count + 1,
       last_snoozed = datetime('now')`,
  ).run(taskTitle, taskCategory, originalDate);
}

export async function dbInsertTaskTiming(
  taskCategory: string,
  taskKeywords: string[],
  estimatedMinutes: number,
  actualMinutes: number,
  date: string,
): Promise<void> {
  const d = getDB();
  d.prepare(
    "INSERT INTO memory_task_timings (task_category, task_keywords, estimated_minutes, actual_minutes, date) VALUES (?,?,?,?,?)",
  ).run(
    taskCategory,
    JSON.stringify(taskKeywords),
    estimatedMinutes,
    actualMinutes,
    date,
  );
  d.prepare(
    "DELETE FROM memory_task_timings WHERE id IN (SELECT id FROM memory_task_timings ORDER BY date DESC LIMIT -1 OFFSET 200)",
  ).run();
}

export async function dbUpdateReflectionMeta(
  lastReflectionAt: string,
  reflectionCount: number,
): Promise<void> {
  const d = getDB();
  d.prepare(
    "UPDATE memory_meta SET last_reflection_at=?, reflection_count=? WHERE id=1",
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
