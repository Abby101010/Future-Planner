/* Starward server — daily tasks repository
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

import type { DailyTask, TaskSource } from "@starward/core";
import { query } from "../db/pool";
import { requireUserId } from "./_context";
import { parseJson } from "./_json";

/** DB-shape task record. We intentionally don't return the full
 *  @starward/core DailyTask because DailyTask doesn't include a date field
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
  /** Where this task originated — drives CRUD lifecycle branching. */
  source: TaskSource;
  /** All variable-shape DailyTask fields live here. */
  payload: Record<string, unknown>;
  // ── Phase A columns (dual-written alongside payload.scheduledTime etc.) ──
  scheduledStartIso: string | null;
  scheduledEndIso: string | null;
  estimatedDurationMinutes: number | null;
  timeBlockStatus: string | null;
  projectTag: string | null;
  // ── Phase B columns (priorityAnnotator output) ──
  cognitiveLoad: string | null;
  cognitiveCost: number | null;
  tier: string | null;
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
  source: string;
  payload: Record<string, unknown> | string | null;
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
  estimated_duration_minutes: number | null;
  time_block_status: string | null;
  project_tag: string | null;
  cognitive_load: string | null;
  cognitive_cost: number | null;
  tier: string | null;
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
    source: (r.source as TaskSource) ?? "user_created",
    payload: parseJson(r.payload),
    scheduledStartIso: r.scheduled_start_time,
    scheduledEndIso: r.scheduled_end_time,
    estimatedDurationMinutes: r.estimated_duration_minutes,
    timeBlockStatus: r.time_block_status,
    projectTag: r.project_tag,
    cognitiveLoad: r.cognitive_load,
    cognitiveCost: r.cognitive_cost,
    tier: r.tier,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Compose an ISO timestamptz from a YYYY-MM-DD date, a HH:MM time-of-day,
 *  and an IANA timezone. Returns null if any input is missing/malformed. The
 *  result is a UTC ISO string that represents the local wall-clock time in
 *  the given zone — so "2026-04-19" + "14:30" + "America/Toronto" →
 *  "2026-04-19T18:30:00.000Z" (EDT offset). */
export function composeIso(
  date: string | null | undefined,
  timeOfDay: string | null | undefined,
  tz: string | null | undefined,
): string | null {
  if (!date || !timeOfDay) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!/^\d{1,2}:\d{2}$/.test(timeOfDay)) return null;
  const zone = tz || "UTC";
  try {
    const [h, m] = timeOfDay.split(":").map(Number);
    // Use the Intl APIs to compute the zone's UTC offset for the given
    // wall-clock time. Build a "as-if-UTC" Date, then subtract the zone's
    // offset at that instant to land on the true UTC instant.
    const asIfUtc = new Date(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    const parts = fmt.formatToParts(asIfUtc).reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
    const asZoneUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
    );
    const offsetMs = asZoneUtc - asIfUtc.getTime();
    return new Date(asIfUtc.getTime() - offsetMs).toISOString();
  } catch {
    return null;
  }
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
  source?: TaskSource;
  payload?: Record<string, unknown>;
  scheduledStartIso?: string | null;
  scheduledEndIso?: string | null;
  estimatedDurationMinutes?: number | null;
  timeBlockStatus?: string | null;
  projectTag?: string | null;
  cognitiveLoad?: string | null;
  cognitiveCost?: number | null;
  tier?: string | null;
}

export async function insert(task: InsertDailyTaskInput): Promise<void> {
  const userId = requireUserId();
  // Derive source from context if not explicitly set
  const source: TaskSource = task.source
    ?? (task.goalId ? "big_goal" : "user_created");
  await query(
    `insert into daily_tasks (
       id, user_id, log_date, goal_id, plan_node_id, title,
       completed, completed_at, order_index, source, payload,
       scheduled_start_time, scheduled_end_time,
       estimated_duration_minutes, time_block_status, project_tag,
       cognitive_load, cognitive_cost, tier,
       updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb,
       $12, $13, $14, $15, $16,
       $17, $18, $19,
       now()
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
      source,
      JSON.stringify(task.payload ?? {}),
      task.scheduledStartIso ?? null,
      task.scheduledEndIso ?? null,
      task.estimatedDurationMinutes ?? null,
      task.timeBlockStatus ?? null,
      task.projectTag ?? null,
      task.cognitiveLoad ?? null,
      task.cognitiveCost ?? null,
      task.tier ?? null,
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
  scheduledStartIso?: string | null;
  scheduledEndIso?: string | null;
  estimatedDurationMinutes?: number | null;
  timeBlockStatus?: string | null;
  projectTag?: string | null;
  cognitiveLoad?: string | null;
  cognitiveCost?: number | null;
  tier?: string | null;
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
       scheduled_start_time = $11,
       scheduled_end_time = $12,
       estimated_duration_minutes = $13,
       time_block_status = $14,
       project_tag = $15,
       cognitive_load = $16,
       cognitive_cost = $17,
       tier = $18,
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
      patch.scheduledStartIso !== undefined ? patch.scheduledStartIso : existing.scheduledStartIso,
      patch.scheduledEndIso !== undefined ? patch.scheduledEndIso : existing.scheduledEndIso,
      patch.estimatedDurationMinutes !== undefined ? patch.estimatedDurationMinutes : existing.estimatedDurationMinutes,
      patch.timeBlockStatus !== undefined ? patch.timeBlockStatus : existing.timeBlockStatus,
      patch.projectTag !== undefined ? patch.projectTag : existing.projectTag,
      patch.cognitiveLoad !== undefined ? patch.cognitiveLoad : existing.cognitiveLoad,
      patch.cognitiveCost !== undefined ? patch.cognitiveCost : existing.cognitiveCost,
      patch.tier !== undefined ? patch.tier : existing.tier,
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
 *  candidates for the reschedule confirmation card.
 *
 *  Window: 1–90 days overdue. Resolver derives an `agedOut` flag for
 *  rows >30 days overdue so the UI can style them differently. Tasks
 *  >90 days overdue are NOT returned here — they should have been
 *  swept by `markStaleAsSkipped` (called from tasksView resolver) and
 *  recorded with `payload.skippedReason = "aged-out"` so they're
 *  accounted for in the DB but no longer dominate the active surface.
 *
 *  Contract: no incomplete past task should ever be silently dropped
 *  from the user's awareness. Either it surfaces here as a reschedule
 *  candidate, or it's been deliberately marked skipped (with a
 *  reason) by the stale-sweep. The prior 14-day silent cutoff broke
 *  this contract — restored 2026-04. */
export async function listPendingReschedule(
  today: string,
): Promise<DailyTaskRecord[]> {
  const userId = requireUserId();
  const rows = await query<DailyTaskRow>(
    `select * from daily_tasks
      where user_id = $1
        and log_date < $2
        and log_date >= ($2::date - interval '90 days')
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

/** Mark incomplete tasks older than 90 days as skipped with a recorded
 *  reason. Returns the number of rows affected. Pairs with
 *  `listPendingReschedule` to honor the "no silent drops" contract:
 *  these tasks are still in the DB (queryable for history / undo) but
 *  no longer surface on the active reschedule list. Idempotent — rows
 *  already marked skipped are untouched. */
export async function markStaleAsSkipped(today: string): Promise<number> {
  const userId = requireUserId();
  const result = await query<{ id: string }>(
    `update daily_tasks
        set payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
              'skipped', true,
              'skippedReason', 'aged-out',
              'skippedAt', now()::text
            ),
            updated_at = now()
      where user_id = $1
        and log_date < ($2::date - interval '90 days')
        and completed = false
        and (payload->>'skipped' is null or payload->>'skipped' <> 'true')
      returning id`,
    [userId, today],
  );
  return result.length;
}

/** Find a daily_task linked to a specific plan node ID. Returns the
 *  first match (there should only be one) or null. */
export async function findByPlanNodeId(
  planNodeId: string,
): Promise<DailyTaskRecord | null> {
  const userId = requireUserId();
  const rows = await query<DailyTaskRow>(
    `select * from daily_tasks
      where user_id = $1 and plan_node_id = $2
      limit 1`,
    [userId, planNodeId],
  );
  return rows.length > 0 ? rowToTask(rows[0]) : null;
}

/** Delete all big_goal daily_tasks for `goalId` whose `plan_node_id` no
 *  longer exists in `goal_plan_nodes`. Used after `goalPlan.replacePlan`
 *  so orphaned rows (materialized from a plan that's since been edited
 *  out) don't keep showing up on the Tasks page. Returns the delete
 *  count. Only touches tasks with source='big_goal' and a non-null
 *  plan_node_id — hand-entered tasks attached to a goal are untouched. */
export async function removeOrphanedPlanTasks(goalId: string): Promise<number> {
  const userId = requireUserId();
  const result = await query<{ id: string }>(
    `delete from daily_tasks
       where user_id = $1
         and goal_id = $2
         and source = 'big_goal'
         and plan_node_id is not null
         and plan_node_id not in (
           select id from goal_plan_nodes
             where user_id = $1 and goal_id = $2
         )
       returning id`,
    [userId, goalId],
  );
  return result.length;
}

// Re-export canonical "delete" name since it's a reserved word.
export { remove as delete_ };
export type { DailyTask };
