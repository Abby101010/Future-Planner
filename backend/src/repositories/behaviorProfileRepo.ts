/* Starward server — behavior profile entries repository
 *
 * Wraps `behavior_profile_entries` (migration 0002). Projection of
 * memory_signals + memory_preferences shaped for the behavior/insights UI.
 * `category` groups signals (e.g. "navigation"), `signal` is the specific
 * key, `weight` is learned importance, `observed_at` is last-updated.
 *
 * @starward/core does not model these yet — so we export a local
 * BehaviorProfileEntry interface that view resolvers / command handlers
 * can consume directly.
 */

import { query } from "../db/pool";
import { requireUserId } from "./_context";
import { parseJson } from "./_json";

export interface BehaviorProfileEntry {
  id: string;
  category: string;
  signal: string;
  weight: number;
  observedAt: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface BehaviorProfileRow {
  id: string;
  user_id: string;
  category: string;
  signal: string;
  weight: string | number;
  observed_at: string;
  payload: Record<string, unknown> | string | null;
  created_at: string;
  updated_at: string;
}

function rowToEntry(r: BehaviorProfileRow): BehaviorProfileEntry {
  return {
    id: r.id,
    category: r.category,
    signal: r.signal,
    weight: Number(r.weight),
    observedAt: r.observed_at,
    payload: parseJson(r.payload),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listByCategory(
  category?: string,
): Promise<BehaviorProfileEntry[]> {
  const userId = requireUserId();
  if (category) {
    const rows = await query<BehaviorProfileRow>(
      `select * from behavior_profile_entries
        where user_id = $1 and category = $2
        order by observed_at desc`,
      [userId, category],
    );
    return rows.map(rowToEntry);
  }
  const rows = await query<BehaviorProfileRow>(
    `select * from behavior_profile_entries
      where user_id = $1
      order by observed_at desc`,
    [userId],
  );
  return rows.map(rowToEntry);
}

export interface InsertBehaviorProfileEntryInput {
  id: string;
  category: string;
  signal: string;
  weight?: number;
  observedAt?: string;
  payload?: Record<string, unknown>;
}

export async function insert(
  entry: InsertBehaviorProfileEntryInput,
): Promise<void> {
  const userId = requireUserId();
  await query(
    `insert into behavior_profile_entries (
       id, user_id, category, signal, weight, observed_at, payload, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
     on conflict (user_id, id) do update set
       category = excluded.category,
       signal = excluded.signal,
       weight = excluded.weight,
       observed_at = excluded.observed_at,
       payload = excluded.payload,
       updated_at = now()`,
    [
      entry.id,
      userId,
      entry.category,
      entry.signal,
      entry.weight ?? 0,
      entry.observedAt ?? new Date().toISOString(),
      JSON.stringify(entry.payload ?? {}),
    ],
  );
}

/** Prune old entries. `date` is an ISO timestamp; everything with
 *  observed_at < date for this user is removed. */
export async function deleteOlderThan(date: string): Promise<void> {
  const userId = requireUserId();
  await query(
    `delete from behavior_profile_entries
      where user_id = $1 and observed_at < $2`,
    [userId, date],
  );
}
