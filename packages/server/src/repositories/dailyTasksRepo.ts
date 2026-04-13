/* NorthStar server — daily tasks repository
 *
 * Wraps `daily_tasks` (migration 0002). One row per DailyTask within a day.
 * Stable fields are columns (id, log_date, goal_id, plan_node_id, title,
 * completed, completed_at, order_index); the rest (description,
 * durationMinutes, cognitiveWeight, priority, category, whyToday,
 * progressContribution, isMomentumTask, startedAt, actualMinutes,
 * snoozedCount, skipped) live in `payload` jsonb.
 *
 * daily_tasks references a daily_logs row conceptually but we do NOT enforce
 * an FK — tasks can exist on a date that has no log row, and view resolvers
 * will join them manually when building a DailyLog.
 */

import type { DailyTask } from "@northstar/core";
import { query } from "../db/pool";
import { requireUserId } from "./_context";
import { parseJson } from "./_json";

/** DB-shape task record. We intentionally don't return the full
 *  @northstar/core DailyTask because DailyTask doesn't include a date field
 *  or goal_id — those live on the row here. */
export interface DailyTaskRecord {
  id: string;
  date: string;           // log_date as ISO YYYY-MM-DD
  goalId: string | null;
  planNodeId: string | null;
  title: string;
  completed: boolean;
  completedAt: string | null;
  orderIndex: number;
  /** All variable-shape DailyTask fields live here. */
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface DailyTaskRow {
  id: string;
  user_id: string;
  log_date: string;
  goal_id: string | null;
  plan_node_id: string | null;
  title: string;
  completed: boolean;
  completed_at: string | null;
  order_index: number;
  payload: Record<string, unknown> | string | null;
  created_at: string;
  updated_at: string;
}

function rowToTask(r: DailyTaskRow): DailyTaskRecord {
  return {
    id: r.id,
    date: r.log_date,
    goalId: r.goal_id,
    planNodeId: r.plan_node_id,
    title: r.title,
    completed: r.completed,
    completedAt: r.completed_at,
    orderIndex: r.order_index,
    payload: parseJson(r.payload),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listForDate(date: string): Promise<DailyTaskRecord[]> {
  const userId = requireUserId();
  const rows = await query<DailyTaskRow>(
    `select * from daily_tasks
      where user_id = $1 and log_date = $2
      order by order_index asc, created_at asc`,
    [userId, date],
  );
  return rows.map(rowToTask);
}

export async function listForDateRange(
  start: string,
  end: string,
): Promise<DailyTaskRecord[]> {
  const userId = requireUserId();
  const rows = await query<DailyTaskRow>(
    `select * from daily_tasks
      where user_id = $1 and log_date >= $2 and log_date <= $3
      order by log_date asc, order_index asc`,
    [userId, start, end],
  );
  return rows.map(rowToTask);
}

export async function get(id: string): Promise<DailyTaskRecord | null> {
  const userId = requireUserId();
  const rows = await query<DailyTaskRow>(
    `select * from daily_tasks where user_id = $1 and id = $2`,
    [userId, id],
  );
  return rows.length > 0 ? rowToTask(rows[0]) : null;
}

export interface InsertDailyTaskInput {
  id: string;
  date: string;
  goalId?: string | null;
  planNodeId?: string | null;
  title: string;
  completed?: boolean;
  completedAt?: string | null;
  orderIndex?: number;
  payload?: Record<string, unknown>;
}

export async function insert(task: InsertDailyTaskInput): Promise<void> {
  const userId = requireUserId();
  await query(
    `insert into daily_tasks (
       id, user_id, log_date, goal_id, plan_node_id, title,
       completed, completed_at, order_index, payload, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, now()
     )`,
    [
      task.id,
      userId,
      task.date,
      task.goalId ?? null,
      task.planNodeId ?? null,
      task.title,
      task.completed ?? false,
      task.completedAt ?? null,
      task.orderIndex ?? 0,
      JSON.stringify(task.payload ?? {}),
    ],
  );
}

export interface UpdateDailyTaskPatch {
  title?: string;
  goalId?: string | null;
  planNodeId?: string | null;
  completed?: boolean;
  completedAt?: string | null;
  orderIndex?: number;
  date?: string;
  payload?: Record<string, unknown>;
}

/** Reads the row, merges the patch in memory, and writes it back. This
 *  keeps the SQL simple and avoids building dynamic UPDATE sets. */
export async function update(
  id: string,
  patch: UpdateDailyTaskPatch,
): Promise<void> {
  const userId = requireUserId();
  const existing = await get(id);
  if (!existing) return;
  const mergedPayload = patch.payload
    ? { ...existing.payload, ...patch.payload }
    : existing.payload;
  await query(
    `update daily_tasks set
       title = $3,
       goal_id = $4,
       plan_node_id = $5,
       completed = $6,
       completed_at = $7,
       order_index = $8,
       log_date = $9,
       payload = $10::jsonb,
       updated_at = now()
     where user_id = $1 and id = $2`,
    [
      userId,
      id,
      patch.title ?? existing.title,
      patch.goalId !== undefined ? patch.goalId : existing.goalId,
      patch.planNodeId !== undefined ? patch.planNodeId : existing.planNodeId,
      patch.completed ?? existing.completed,
      patch.completedAt !== undefined
        ? patch.completedAt
        : existing.completedAt,
      patch.orderIndex ?? existing.orderIndex,
      patch.date ?? existing.date,
      JSON.stringify(mergedPayload),
    ],
  );
}

export async function remove(id: string): Promise<void> {
  const userId = requireUserId();
  await query(`delete from daily_tasks where user_id = $1 and id = $2`, [
    userId,
    id,
  ]);
}

export async function removeForDate(date: string): Promise<void> {
  const userId = requireUserId();
  await query(
    `delete from daily_tasks where user_id = $1 and log_date = $2`,
    [userId, date],
  );
}

/** Flip the `completed` flag and stamp `completed_at`. Returns the new
 *  completed state (or null if the row didn't exist). */
export async function toggleCompleted(id: string): Promise<boolean | null> {
  const userId = requireUserId();
  const existing = await get(id);
  if (!existing) return null;
  const nextCompleted = !existing.completed;
  await query(
    `update daily_tasks
        set completed = $3,
            completed_at = $4,
            updated_at = now()
      where user_id = $1 and id = $2`,
    [
      userId,
      id,
      nextCompleted,
      nextCompleted ? new Date().toISOString() : null,
    ],
  );
  return nextCompleted;
}

/** Find incomplete, un-skipped tasks from dates before `today` that
 *  haven't been snoozed past a future reminder time. These are
 *  candidates for the reschedule confirmation card. Limited to the
 *  last 14 days to avoid surfacing ancient tasks. */
export async function listPendingReschedule(
  today: string,
): Promise<DailyTaskRecord[]> {
  const userId = requireUserId();
  const rows = await query<DailyTaskRow>(
    `select * from daily_tasks
      where user_id = $1
        and log_date < $2
        and log_date >= ($2::date - interval '14 days')
        and completed = false
      order by log_date desc, order_index asc`,
    [userId, today],
  );
  return rows
    .map(rowToTask)
    .filter((t) => {
      const pl = t.payload;
      // Skip tasks already marked skipped or dismissed from reschedule
      if (pl.skipped) return false;
      if (pl.rescheduleDismissed) return false;
      // Skip tasks snoozed to a future reminder
      if (typeof pl.rescheduleSnoozeUntil === "string" && pl.rescheduleSnoozeUntil > today) return false;
      return true;
    });
}

// Re-export canonical "delete" name since it's a reserved word.
export { remove as delete_ };
export type { DailyTask };
