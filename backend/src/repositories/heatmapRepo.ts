/* Starward server — heatmap entries repository
 *
 * Wraps `heatmap_entries` (migration 0002). One row per (user, date) with
 * a numeric `value` (0..4 completionLevel today, fractional in the future).
 * Streak metadata lives on daily_logs.payload — not here — because the
 * calendar grid reads heatmap_entries every render and we want this table
 * narrow.
 */

import type { HeatmapEntry } from "@starward/core";
import { query } from "../db/pool";
import { requireUserId } from "./_context";
import { parseJson } from "./_json";

interface HeatmapEntryRow {
  user_id: string;
  entry_date: string;
  value: string | number;   // pg returns numeric as string
  payload: Record<string, unknown> | string | null;
  created_at: string;
  updated_at: string;
}

function rowToEntry(r: HeatmapEntryRow): HeatmapEntry {
  const payload = parseJson(r.payload);
  const level = Math.max(0, Math.min(4, Math.round(Number(r.value)))) as
    | 0
    | 1
    | 2
    | 3
    | 4;
  return {
    date: r.entry_date,
    completionLevel: level,
    currentStreak: (payload.currentStreak as number) ?? 0,
    totalActiveDays: (payload.totalActiveDays as number) ?? 0,
    longestStreak: (payload.longestStreak as number) ?? 0,
  };
}

export async function listRange(
  startDate: string,
  endDate: string,
): Promise<HeatmapEntry[]> {
  const userId = requireUserId();
  const rows = await query<HeatmapEntryRow>(
    `select * from heatmap_entries
      where user_id = $1 and entry_date >= $2 and entry_date <= $3
      order by entry_date asc`,
    [userId, startDate, endDate],
  );
  return rows.map(rowToEntry);
}

export async function upsert(entry: HeatmapEntry): Promise<void> {
  const userId = requireUserId();
  const payload = {
    currentStreak: entry.currentStreak,
    totalActiveDays: entry.totalActiveDays,
    longestStreak: entry.longestStreak,
  };
  await query(
    `insert into heatmap_entries (
       user_id, entry_date, value, payload, updated_at
     ) values ($1, $2, $3, $4::jsonb, now())
     on conflict (user_id, entry_date) do update set
       value = excluded.value,
       payload = excluded.payload,
       updated_at = now()`,
    [userId, entry.date, entry.completionLevel, JSON.stringify(payload)],
  );
}

export async function remove(date: string): Promise<void> {
  const userId = requireUserId();
  await query(
    `delete from heatmap_entries where user_id = $1 and entry_date = $2`,
    [userId, date],
  );
}

export { remove as delete_ };
