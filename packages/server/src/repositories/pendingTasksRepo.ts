/* NorthStar server — pending tasks repository
 *
 * Wraps `pending_tasks` (migration 0002). Holds AI-generated task proposals
 * from the home chat / planner that are awaiting user confirm. The analysis
 * blob (title, suggestedDate, cognitiveWeight, etc.) lives inside `payload`
 * alongside the raw userInput text.
 */

import type { PendingTask } from "@northstar/core";
import { query } from "../db/pool";
import { requireUserId } from "./_context";
import { parseJson } from "./_json";

type PendingTaskStatus = PendingTask["status"] | "pending";

interface PendingTaskRow {
  id: string;
  user_id: string;
  source: string;
  title: string;
  status: string;
  payload: Record<string, unknown> | string | null;
  created_at: string;
  updated_at: string;
}

/** DB-shape pending task. The @northstar/core PendingTask type has a
 *  mandatory `analysis` field that's nullable while "analyzing" — we
 *  preserve both shapes by storing analysis inside payload. */
export interface PendingTaskRecord {
  id: string;
  source: string;
  title: string;
  status: PendingTaskStatus;
  /** userInput, analysis, and any other AI-generated fields. */
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

function rowToRecord(r: PendingTaskRow): PendingTaskRecord {
  return {
    id: r.id,
    source: r.source,
    title: r.title,
    status: r.status as PendingTaskStatus,
    payload: parseJson(r.payload),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function list(
  statusFilter?: PendingTaskStatus,
): Promise<PendingTaskRecord[]> {
  const userId = requireUserId();
  if (statusFilter) {
    const rows = await query<PendingTaskRow>(
      `select * from pending_tasks
        where user_id = $1 and status = $2
        order by created_at desc`,
      [userId, statusFilter],
    );
    return rows.map(rowToRecord);
  }
  const rows = await query<PendingTaskRow>(
    `select * from pending_tasks
      where user_id = $1
      order by created_at desc`,
    [userId],
  );
  return rows.map(rowToRecord);
}

export async function get(id: string): Promise<PendingTaskRecord | null> {
  const userId = requireUserId();
  const rows = await query<PendingTaskRow>(
    `select * from pending_tasks where user_id = $1 and id = $2`,
    [userId, id],
  );
  return rows.length > 0 ? rowToRecord(rows[0]) : null;
}

export interface InsertPendingTaskInput {
  id: string;
  source?: string;
  title?: string;
  status?: PendingTaskStatus;
  payload?: Record<string, unknown>;
}

export async function insert(task: InsertPendingTaskInput): Promise<void> {
  const userId = requireUserId();
  await query(
    `insert into pending_tasks (
       id, user_id, source, title, status, payload, updated_at
     ) values ($1, $2, $3, $4, $5, $6::jsonb, now())
     on conflict (user_id, id) do update set
       source = excluded.source,
       title = excluded.title,
       status = excluded.status,
       payload = excluded.payload,
       updated_at = now()`,
    [
      task.id,
      userId,
      task.source ?? "home-chat",
      task.title ?? "",
      task.status ?? "pending",
      JSON.stringify(task.payload ?? {}),
    ],
  );
}

export async function updateStatus(
  id: string,
  status: PendingTaskStatus,
): Promise<void> {
  const userId = requireUserId();
  await query(
    `update pending_tasks
        set status = $3, updated_at = now()
      where user_id = $1 and id = $2`,
    [userId, id, status],
  );
}

export async function remove(id: string): Promise<void> {
  const userId = requireUserId();
  await query(`delete from pending_tasks where user_id = $1 and id = $2`, [
    userId,
    id,
  ]);
}

export { remove as delete_ };
