/* NorthStar server — goals repository
 *
 * Typed data access for the `goals` table (migration 0002). Promotes the
 * stable top-level fields of the @northstar/core Goal type to columns and
 * round-trips the rest (planChat, plan, flatPlan, repeatSchedule, etc.) via
 * the `payload` jsonb column.
 *
 * All queries are parameterized and user_id-scoped via getCurrentUserId().
 * No business logic lives here — pure CRUD.
 */

import type { Goal, GoalImportance, GoalScope, GoalType } from "@northstar/core";
import { query } from "../db/pool";
import { requireUserId } from "./_context";
import { parseJson } from "./_json";

interface GoalRow {
  id: string;
  user_id: string;
  title: string;
  description: string;
  target_date: string | null;
  category: string | null;
  status: string;
  priority: string;
  goal_type: string | null;
  scope: string | null;
  is_habit: boolean;
  icon: string | null;
  plan_confirmed: boolean;
  progress_percent: number | null;
  goal_slot: string | null;
  payload: Record<string, unknown> | string | null;
  created_at: string;
  updated_at: string;
}

function rowToGoal(r: GoalRow): Goal {
  const meta = parseJson(r.payload);
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    targetDate: r.target_date ?? "",
    isHabit: r.is_habit,
    importance: (r.priority as GoalImportance) ?? "medium",
    scope: (r.scope as GoalScope) ?? "big",
    goalType: (r.goal_type as GoalType) ?? "big",
    status: r.status as Goal["status"],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    icon: r.icon ?? undefined,
    planChat: (meta.planChat as Goal["planChat"]) ?? [],
    plan: (meta.plan as Goal["plan"]) ?? null,
    flatPlan: (meta.flatPlan as Goal["flatPlan"]) ?? null,
    planConfirmed: r.plan_confirmed,
    scopeReasoning: (meta.scopeReasoning as string) ?? "",
    repeatSchedule: (meta.repeatSchedule as Goal["repeatSchedule"]) ?? null,
    suggestedTimeSlot: meta.suggestedTimeSlot as string | undefined,
    goalSlot: (r.goal_slot as Goal["goalSlot"]) ?? null,
    progressPercent: r.progress_percent ?? undefined,
    notes: meta.notes as string | undefined,
    rescheduleBannerDismissed: meta.rescheduleBannerDismissed as
      | boolean
      | undefined,
  };
}

/** Extract the jsonb "payload" blob from a Goal — i.e. everything that does
 *  NOT round-trip through a typed column. */
function goalToPayload(g: Goal): Record<string, unknown> {
  return {
    planChat: g.planChat ?? [],
    plan: g.plan ?? null,
    flatPlan: g.flatPlan ?? null,
    scopeReasoning: g.scopeReasoning ?? "",
    repeatSchedule: g.repeatSchedule ?? null,
    suggestedTimeSlot: g.suggestedTimeSlot,
    notes: g.notes,
    rescheduleBannerDismissed: g.rescheduleBannerDismissed,
  };
}

export async function list(): Promise<Goal[]> {
  const userId = requireUserId();
  const rows = await query<GoalRow>(
    `select * from goals where user_id = $1 order by updated_at desc`,
    [userId],
  );
  return rows.map(rowToGoal);
}

export async function get(id: string): Promise<Goal | null> {
  const userId = requireUserId();
  const rows = await query<GoalRow>(
    `select * from goals where user_id = $1 and id = $2`,
    [userId, id],
  );
  return rows.length > 0 ? rowToGoal(rows[0]) : null;
}

export async function upsert(goal: Goal): Promise<void> {
  const userId = requireUserId();
  await query(
    `insert into goals (
       id, user_id, title, description, target_date, status, priority,
       goal_type, scope, is_habit, icon, plan_confirmed, progress_percent,
       goal_slot, payload, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, now()
     )
     on conflict (user_id, id) do update set
       title = excluded.title,
       description = excluded.description,
       target_date = excluded.target_date,
       status = excluded.status,
       priority = excluded.priority,
       goal_type = excluded.goal_type,
       scope = excluded.scope,
       is_habit = excluded.is_habit,
       icon = excluded.icon,
       plan_confirmed = excluded.plan_confirmed,
       progress_percent = excluded.progress_percent,
       goal_slot = excluded.goal_slot,
       payload = excluded.payload,
       updated_at = now()`,
    [
      goal.id,
      userId,
      goal.title,
      goal.description ?? "",
      goal.targetDate || null,
      goal.status,
      goal.importance,
      goal.goalType,
      goal.scope,
      goal.isHabit,
      goal.icon ?? null,
      goal.planConfirmed,
      goal.progressPercent ?? null,
      goal.goalSlot ?? null,
      JSON.stringify(goalToPayload(goal)),
    ],
  );
}

export async function remove(id: string): Promise<void> {
  const userId = requireUserId();
  await query(`delete from goals where user_id = $1 and id = $2`, [userId, id]);
}

export async function updateProgress(
  id: string,
  percent: number,
): Promise<void> {
  const userId = requireUserId();
  await query(
    `update goals
        set progress_percent = $3, updated_at = now()
      where user_id = $1 and id = $2`,
    [userId, id, Math.max(0, Math.min(100, Math.round(percent)))],
  );
}

export async function setGoalSlot(
  id: string,
  slot: "primary" | "secondary" | "personal" | null,
): Promise<void> {
  const userId = requireUserId();
  await query(
    `update goals
        set goal_slot = $3, updated_at = now()
      where user_id = $1 and id = $2`,
    [userId, id, slot],
  );
}

// `delete` is a reserved word, re-export `remove` under the expected name.
export { remove as delete_ };
