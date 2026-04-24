/* Starward server — goals repository
 *
 * Typed data access for the `goals` table (migration 0002). Promotes the
 * stable top-level fields of the @starward/core Goal type to columns and
 * round-trips the rest (planChat, plan, flatPlan, repeatSchedule, etc.) via
 * the `payload` jsonb column.
 *
 * All queries are parameterized and user_id-scoped via getCurrentUserId().
 * No business logic lives here — pure CRUD.
 */

import type {
  Goal,
  GoalImportance,
  GoalPlan,
  GoalScope,
  GoalType,
  LaborMarketData,
  OverrideLogEntry,
} from "@starward/core";
import { query } from "../db/pool";
import { requireUserId } from "./_context";
import { parseJson } from "./_json";
import { normalizePlan } from "./goalPlanRepo";

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
  goal_description: string;
  goal_metadata: Record<string, unknown> | string | null;
  user_notes: string;
  clarification_answers: Record<string, unknown> | string | null;
  // 0013 methodology columns
  weekly_hours_target: string | number | null;
  current_phase: string | null;
  funnel_metrics: Record<string, unknown> | string | null;
  skill_map: Record<string, unknown> | string | null;
  labor_market_data: Record<string, unknown> | string | null;
  plan_rationale: string | null;
  pace_tasks_per_day: string | number | null;
  pace_last_computed_at: string | Date | null;
  override_log: unknown[] | string | null;
  created_at: string;
  updated_at: string;
}

function nullableNumber(v: string | number | null | undefined): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function nullableTimestamp(v: string | Date | null | undefined): string | undefined {
  if (!v) return undefined;
  return v instanceof Date ? v.toISOString() : String(v);
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
    createdAt: (r.created_at as unknown) instanceof Date ? (r.created_at as unknown as Date).toISOString() : String(r.created_at),
    updatedAt: (r.updated_at as unknown) instanceof Date ? (r.updated_at as unknown as Date).toISOString() : String(r.updated_at),
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
    goalDescription: r.goal_description ?? "",
    goalMetadata: parseJson(r.goal_metadata),
    userNotes: r.user_notes ?? "",
    clarificationAnswers: parseJson(r.clarification_answers),
    rescheduleBannerDismissed: meta.rescheduleBannerDismissed as
      | boolean
      | undefined,
    // 0013 methodology fields
    weeklyHoursTarget: nullableNumber(r.weekly_hours_target),
    currentPhase: r.current_phase ?? undefined,
    funnelMetrics: parseJson(r.funnel_metrics),
    skillMap: parseJson(r.skill_map),
    laborMarketData: parseJson(r.labor_market_data) as LaborMarketData,
    planRationale: r.plan_rationale ?? undefined,
    paceTasksPerDay: nullableNumber(r.pace_tasks_per_day),
    paceLastComputedAt: nullableTimestamp(r.pace_last_computed_at),
    overrideLog: (() => {
      const parsed: unknown = parseJson(r.override_log);
      return Array.isArray(parsed) ? (parsed as OverrideLogEntry[]) : [];
    })(),
  };
}

/** Extract the jsonb "payload" blob from a Goal — i.e. everything that does
 *  NOT round-trip through a typed column. */
function goalToPayload(g: Goal): Record<string, unknown> {
  if (g.plan) normalizePlan(g.plan as GoalPlan);
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
       goal_slot, payload,
       goal_description, goal_metadata, user_notes, clarification_answers,
       weekly_hours_target, current_phase, funnel_metrics, skill_map,
       labor_market_data, plan_rationale, pace_tasks_per_day,
       pace_last_computed_at, override_log,
       updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb,
       $16, $17::jsonb, $18, $19::jsonb,
       $20, $21, $22::jsonb, $23::jsonb, $24::jsonb, $25, $26, $27, $28::jsonb,
       now()
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
       goal_description = excluded.goal_description,
       goal_metadata = excluded.goal_metadata,
       user_notes = excluded.user_notes,
       clarification_answers = excluded.clarification_answers,
       weekly_hours_target = excluded.weekly_hours_target,
       current_phase = excluded.current_phase,
       funnel_metrics = excluded.funnel_metrics,
       skill_map = excluded.skill_map,
       labor_market_data = excluded.labor_market_data,
       plan_rationale = excluded.plan_rationale,
       pace_tasks_per_day = excluded.pace_tasks_per_day,
       pace_last_computed_at = excluded.pace_last_computed_at,
       override_log = excluded.override_log,
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
      goal.goalDescription ?? "",
      JSON.stringify(goal.goalMetadata ?? {}),
      goal.userNotes ?? "",
      JSON.stringify(goal.clarificationAnswers ?? {}),
      goal.weeklyHoursTarget ?? null,
      goal.currentPhase ?? null,
      JSON.stringify(goal.funnelMetrics ?? {}),
      JSON.stringify(goal.skillMap ?? {}),
      JSON.stringify(goal.laborMarketData ?? {}),
      goal.planRationale ?? null,
      goal.paceTasksPerDay ?? null,
      goal.paceLastComputedAt ?? null,
      JSON.stringify(goal.overrideLog ?? []),
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

export async function updateStatus(
  id: string,
  status: string,
  progressPercent?: number,
): Promise<void> {
  const userId = requireUserId();
  const extra = progressPercent !== undefined
    ? `, progress_percent = ${Math.max(0, Math.min(100, Math.round(progressPercent)))}`
    : "";
  await query(
    `update goals
        set status = $3${extra}, updated_at = now()
      where user_id = $1 and id = $2`,
    [userId, id, status],
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

/** Append an entry to `goals.override_log`. Used by dashboard edit commands
 *  so user modifications persist as an auditable trail separate from AI
 *  output — the planner reads this on regeneration to explain why it's
 *  adjusting around the user instead of overwriting them. */
export async function appendOverrideEntry(
  id: string,
  entry: Omit<OverrideLogEntry, "ts"> & { ts?: string },
): Promise<void> {
  const userId = requireUserId();
  const full: OverrideLogEntry = { ts: entry.ts ?? new Date().toISOString(), ...entry };
  await query(
    `update goals
        set override_log = coalesce(override_log, '[]'::jsonb) || $3::jsonb,
            updated_at = now()
      where user_id = $1 and id = $2`,
    [userId, id, JSON.stringify([full])],
  );
}

/** Persist a pace snapshot on `goals`. Written by cmdConfirmGoalPlan and
 *  the adaptive-reschedule job so the FE never waits on on-the-fly pace
 *  detection. Null `tasksPerDay` clears the snapshot. */
export async function setPaceSnapshot(
  id: string,
  tasksPerDay: number | null,
): Promise<void> {
  const userId = requireUserId();
  await query(
    `update goals
        set pace_tasks_per_day = $3,
            pace_last_computed_at = case when $3 is null then null else now() end,
            updated_at = now()
      where user_id = $1 and id = $2`,
    [userId, id, tasksPerDay],
  );
}

// `delete` is a reserved word, re-export `remove` under the expected name.
export { remove as delete_ };
