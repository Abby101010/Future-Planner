/* NorthStar server — daily logs repository
 *
 * Wraps `daily_logs` (migration 0002). PK is (user_id, log_date). Stable
 * fields (mood, energy, notes, reflection) are columns; the variable-shape
 * pieces of DailyLog — notificationBriefing, milestoneCelebration, progress,
 * yesterdayRecap, encouragement, heatmapEntry — live in the payload jsonb.
 *
 * Note: this repository owns the log row ONLY. The daily_tasks list for a
 * given date is owned by dailyTasksRepo; callers that need a hydrated
 * DailyLog in the @northstar/core shape should join the two in a view
 * resolver (Task 12).
 */

import type { DailyLog, MoodEntry } from "@northstar/core";
import { query } from "../db/pool";
import { requireUserId } from "./_context";

interface DailyLogRow {
  user_id: string;
  log_date: string;
  mood: string | null;
  energy: string | null;
  notes: string | null;
  reflection: string | null;
  payload: Record<string, unknown> | string | null;
  created_at: string;
  updated_at: string;
}

/** DB-shaped daily log row. View resolvers will hydrate this into a full
 *  DailyLog (with tasks joined from daily_tasks). We intentionally don't
 *  return the full @northstar/core DailyLog from this repo because the
 *  tasks array doesn't live in this table. */
export interface DailyLogRecord {
  date: string; // ISO date (YYYY-MM-DD)
  mood: MoodEntry | null;
  energy: string | null;
  notes: string | null;
  reflection: string | null;
  /** Variable-shape fields: notificationBriefing, milestoneCelebration,
   *  progress, yesterdayRecap, encouragement, heatmapEntry, id, etc. */
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

function parseJson(v: unknown): Record<string, unknown> {
  if (!v) return {};
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return v as Record<string, unknown>;
}

function parseMood(
  raw: string | null,
  payload: Record<string, unknown>,
): MoodEntry | null {
  // Prefer a structured mood blob if the payload has one (set by upsert below).
  const stored = payload.mood as MoodEntry | undefined;
  if (stored && typeof stored === "object") return stored;
  if (!raw) return null;
  const level = Number(raw);
  if (!Number.isFinite(level) || level < 1 || level > 5) return null;
  return {
    date: "",
    level: level as MoodEntry["level"],
    timestamp: "",
  };
}

function rowToRecord(r: DailyLogRow): DailyLogRecord {
  const payload = parseJson(r.payload);
  return {
    date: r.log_date,
    mood: parseMood(r.mood, payload),
    energy: r.energy,
    notes: r.notes,
    reflection: r.reflection,
    payload,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function get(date: string): Promise<DailyLogRecord | null> {
  const userId = requireUserId();
  const rows = await query<DailyLogRow>(
    `select * from daily_logs where user_id = $1 and log_date = $2`,
    [userId, date],
  );
  return rows.length > 0 ? rowToRecord(rows[0]) : null;
}

export async function list(
  startDate: string,
  endDate: string,
): Promise<DailyLogRecord[]> {
  const userId = requireUserId();
  const rows = await query<DailyLogRow>(
    `select * from daily_logs
      where user_id = $1 and log_date >= $2 and log_date <= $3
      order by log_date asc`,
    [userId, startDate, endDate],
  );
  return rows.map(rowToRecord);
}

/** Accepts a partial DailyLog-ish object. We promote mood level to the
 *  `mood` column and stash everything else in payload. */
export async function upsert(log: {
  date: string;
  mood?: MoodEntry | null;
  energy?: string | null;
  notes?: string | null;
  reflection?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const userId = requireUserId();
  const moodLevel =
    log.mood && typeof log.mood.level === "number"
      ? String(log.mood.level)
      : null;
  // Preserve the full mood object inside payload so we can round-trip note/
  // timestamp/date fields without adding columns for them.
  const mergedPayload: Record<string, unknown> = { ...(log.payload ?? {}) };
  if (log.mood) mergedPayload.mood = log.mood;
  await query(
    `insert into daily_logs (
       user_id, log_date, mood, energy, notes, reflection, payload, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
     on conflict (user_id, log_date) do update set
       mood = excluded.mood,
       energy = excluded.energy,
       notes = excluded.notes,
       reflection = excluded.reflection,
       payload = excluded.payload,
       updated_at = now()`,
    [
      userId,
      log.date,
      moodLevel,
      log.energy ?? null,
      log.notes ?? null,
      log.reflection ?? null,
      JSON.stringify(mergedPayload),
    ],
  );
}

export async function remove(date: string): Promise<void> {
  const userId = requireUserId();
  await query(
    `delete from daily_logs where user_id = $1 and log_date = $2`,
    [userId, date],
  );
}

// Re-export canonical "delete" name that can't be used as an identifier.
export { remove as delete_ };
// A reference to DailyLog is kept so TS ensures the module lines up with core
// even though we don't return that exact shape yet.
export type { DailyLog };
