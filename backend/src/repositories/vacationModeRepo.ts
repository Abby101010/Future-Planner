/* NorthStar server — vacation mode repository
 *
 * Wraps `vacation_mode` (migration 0002). Exactly one row per user (PK is
 * user_id alone). `reason` is nullable and not present in the legacy client
 * state shape — we expose it here so future UI can surface "why" without a
 * migration.
 */

import { query } from "../db/pool";
import { requireUserId } from "./_context";
import { parseJson } from "./_json";

export interface VacationModeState {
  active: boolean;
  startDate: string | null;
  endDate: string | null;
  reason: string | null;
  payload: Record<string, unknown>;
  updatedAt: string;
}

interface VacationModeRow {
  user_id: string;
  active: boolean;
  start_date: string | null;
  end_date: string | null;
  reason: string | null;
  payload: Record<string, unknown> | string | null;
  created_at: string;
  updated_at: string;
}

function rowToState(r: VacationModeRow): VacationModeState {
  return {
    active: r.active,
    startDate: r.start_date,
    endDate: r.end_date,
    reason: r.reason,
    payload: parseJson(r.payload),
    updatedAt: r.updated_at,
  };
}

/** Returns the user's vacation mode row, or null if they've never set it.
 *  Callers that want a guaranteed default should ?? the call. */
export async function get(): Promise<VacationModeState | null> {
  const userId = requireUserId();
  const rows = await query<VacationModeRow>(
    `select * from vacation_mode where user_id = $1`,
    [userId],
  );
  return rows.length > 0 ? rowToState(rows[0]) : null;
}

export interface UpsertVacationModeInput {
  active: boolean;
  startDate?: string | null;
  endDate?: string | null;
  reason?: string | null;
  payload?: Record<string, unknown>;
}

export async function upsert(state: UpsertVacationModeInput): Promise<void> {
  const userId = requireUserId();
  await query(
    `insert into vacation_mode (
       user_id, active, start_date, end_date, reason, payload, updated_at
     ) values ($1, $2, $3, $4, $5, $6::jsonb, now())
     on conflict (user_id) do update set
       active = excluded.active,
       start_date = excluded.start_date,
       end_date = excluded.end_date,
       reason = excluded.reason,
       payload = excluded.payload,
       updated_at = now()`,
    [
      userId,
      state.active,
      state.startDate ?? null,
      state.endDate ?? null,
      state.reason ?? null,
      JSON.stringify(state.payload ?? {}),
    ],
  );
}
