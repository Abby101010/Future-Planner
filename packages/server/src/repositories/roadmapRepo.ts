/* NorthStar server — roadmap repository
 *
 * Wraps the `roadmap` table (migration 0004). Exactly one row per user.
 * Replaces `app_store.roadmap`. The Roadmap object is hierarchical and
 * we have no query that indexes inner fields, so the entire object
 * round-trips through the `payload` jsonb column.
 */

import type { Roadmap } from "@northstar/core";
import { query } from "../db/pool";
import { requireUserId } from "./_context";
import { parseJson } from "./_json";

interface RoadmapRow {
  user_id: string;
  payload: Record<string, unknown> | string | null;
  created_at: string;
  updated_at: string;
}

export async function get(): Promise<Roadmap | null> {
  const userId = requireUserId();
  const rows = await query<RoadmapRow>(
    `select * from roadmap where user_id = $1`,
    [userId],
  );
  if (rows.length === 0) return null;
  const payload = parseJson(rows[0].payload);
  return Object.keys(payload).length > 0 ? (payload as unknown as Roadmap) : null;
}

export async function upsert(roadmap: Roadmap): Promise<void> {
  const userId = requireUserId();
  await query(
    `insert into roadmap (user_id, payload, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (user_id) do update set
       payload = excluded.payload,
       updated_at = now()`,
    [userId, JSON.stringify(roadmap)],
  );
}

export async function remove(): Promise<void> {
  const userId = requireUserId();
  await query(`delete from roadmap where user_id = $1`, [userId]);
}

export { remove as delete_ };
