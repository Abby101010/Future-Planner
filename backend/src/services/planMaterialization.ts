/* Plan materialization service.
 *
 * Bridges the long-horizon plan tree (`goal_plan_nodes`) with the short-
 * horizon execution log (`daily_tasks`). For any non-locked plan-task
 * whose resolved date falls within the next 14 days, this module writes
 * a `daily_tasks` row with `source = "big_goal"` and `plan_node_id`
 * pointing back at the plan task — so the Tasks page, Calendar, and
 * daily planner all see the scheduled work.
 *
 * ⚠ Contract: called from
 *   - `cmdConfirmGoalPlan` on first accept of a plan
 *   - `goalPlan.replacePlan` for goals that are already `planConfirmed`,
 *     so chat amendments / regenerations propagate automatically
 *
 * Previously this logic was a private helper inside
 * `routes/commands/goals.ts`, which meant every chat-driven
 * `replacePlan` (and any future plan-write path) had to remember to
 * call it. Extracting it here + making `replacePlan` the enforcement
 * point eliminates the "forgot to materialize" bug class.
 */

import { COGNITIVE_BUDGET } from "@starward/core";
import type { GoalPlan, GoalPlanTask } from "@starward/core";
import * as repos from "../repositories";

/** Delete daily_tasks rows for this goal whose `plan_node_id` no longer
 *  exists in `goal_plan_nodes`. Call this BEFORE `materializePlanTasks`
 *  when a plan has been rewritten — otherwise the old (now-orphan) rows
 *  keep showing up on the Tasks page alongside the new materializations.
 *  Returns the delete count. */
export async function pruneOrphanedPlanTasks(goalId: string): Promise<number> {
  return repos.dailyTasks.removeOrphanedPlanTasks(goalId);
}

/** Walk the plan hierarchy, resolve day labels to dates, and insert
 *  `daily_tasks` rows for any task within the next 14 days. Idempotent:
 *  plan tasks already materialized (by plan_node_id) are skipped, so
 *  calling twice in a row is safe. Returns how many new rows were
 *  inserted.
 *
 *  ⚠ Cognitive budget cap: each calendar day gets at most
 *  `COGNITIVE_BUDGET.MAX_DAILY_TASKS` *active* plan-derived rows.
 *  Once a day hits that ceiling, additional plan tasks for that day
 *  are inserted with `priority: "bonus"` (cognitiveWeight 1) so they
 *  land in the bonus pool — visible on the Today page, but separate
 *  from the active list and excluded from KPIs. This matches the
 *  existing triage demote-to-bonus behavior in views/tasksView.ts and
 *  preserves the "what changed?" signal for the user when they tweak
 *  a goal mid-day: previously over-budget tasks were silently dropped
 *  from materialization (left in the tree, invisible), so the user
 *  thought their plan rewrite did nothing. */
export async function materializePlanTasks(
  goalId: string,
  plan: GoalPlan | null,
): Promise<number> {
  if (!plan || !Array.isArray(plan.years)) return 0;

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 14);
  const horizonStr = horizon.toISOString().split("T")[0];

  const tasksToMaterialize: Array<{ date: string; task: GoalPlanTask }> = [];

  for (const year of plan.years) {
    for (const month of year.months) {
      for (const week of month.weeks) {
        if (week.locked) continue;
        const weekRange = parseWeekRange(week.label, today.getFullYear());
        for (const day of week.days) {
          const resolvedDate = resolveDayDate(day.label, weekRange, today);
          if (!resolvedDate) continue;
          if (resolvedDate < todayStr || resolvedDate > horizonStr) continue;
          for (const task of day.tasks) {
            if (task.completed) continue;
            tasksToMaterialize.push({ date: resolvedDate, task });
          }
        }
      }
    }
  }

  const existingTasks = await repos.dailyTasks.listForDateRange(todayStr, horizonStr);
  const existingPlanNodeIds = new Set(
    existingTasks.filter((t) => t.planNodeId).map((t) => t.planNodeId),
  );

  // Pre-count existing rows per date so the budget cap accounts for
  // tasks already there (from another goal's prior materialization,
  // user-created tasks, etc.). We update this map in-loop as we
  // insert so a single materialize call can't itself overflow.
  const countByDate = new Map<string, number>();
  for (const t of existingTasks) {
    countByDate.set(t.date, (countByDate.get(t.date) ?? 0) + 1);
  }
  const MAX = COGNITIVE_BUDGET.MAX_DAILY_TASKS;

  let count = 0;
  for (const { date, task } of tasksToMaterialize) {
    if (existingPlanNodeIds.has(task.id)) continue;
    // Day at capacity → demote to bonus instead of dropping. The row
    // still gets written; it just lands in the bonus pool with weight
    // 1 so it doesn't push the active list past the cognitive ceiling.
    const atCapacity = (countByDate.get(date) ?? 0) >= MAX;
    const effectivePriority: GoalPlanTask["priority"] = atCapacity
      ? "bonus"
      : (task.priority ?? "should-do");
    const effectiveWeight =
      effectivePriority === "must-do"
        ? 5
        : effectivePriority === "bonus"
          ? 1
          : 3;
    const taskId = `plan-${goalId.slice(0, 8)}-${task.id}`;
    try {
      const existing = await repos.dailyTasks.listForDate(date);
      await repos.dailyTasks.insert({
        id: taskId,
        date,
        goalId,
        planNodeId: task.id,
        title: task.title,
        completed: false,
        orderIndex: existing.length,
        source: "big_goal",
        payload: {
          description: task.description ?? "",
          durationMinutes: task.durationMinutes ?? 30,
          cognitiveWeight: effectiveWeight,
          priority: effectivePriority,
          category: task.category ?? "planning",
          source: "plan-materialized",
          // Phase A — energyType lives in payload (no top-level column
          // on daily_tasks; cognitiveLoad/Cost get top-level columns
          // since lightTriage and the future cognitiveLoadScheduler
          // query them directly).
          ...(task.energyType ? { energyType: task.energyType } : {}),
        },
        // Carry the plan-tree dependsOn list onto the daily_tasks row so
        // dependency resolution doesn't have to JOIN through the plan
        // tree at runtime. The plan tree's task IDs match the
        // planNodeId, so dependsOn refs are still valid post-materialize.
        // Migration 0018_task_dependencies.sql.
        dependsOn: Array.isArray(task.dependsOn) ? task.dependsOn : null,
        // Phase A — propagate cognitive-load classification from the
        // plan tree to daily_tasks columns (migration 0011). Pre-
        // populating here means lightTriage's isAnnotated() check
        // returns true and the priorityAnnotator falls through as a
        // no-op rectifier instead of re-classifying every plan task.
        cognitiveLoad: task.cognitiveLoad ?? null,
        cognitiveCost:
          typeof task.cognitiveCost === "number" ? task.cognitiveCost : null,
      });
      count++;
      countByDate.set(date, (countByDate.get(date) ?? 0) + 1);
    } catch {
      // Duplicate key — already materialized, safe to skip.
    }
  }

  // Fire-and-forget downstream pipelines for each date that received new rows.
  //   1. Light triage (priority annotation + cap demotion).
  //   2. Duration estimator — pulls MAX_DEEP_MINUTES out of dormancy
  //      for these rows. Without this, "0h 0m planned" stays on the
  //      header and the time-budget check uses 30-min defaults that
  //      hide real overload.
  // Both are fire-and-forget; the materialize result returns immediately.
  if (count > 0) {
    const touchedDates = Array.from(countByDate.entries())
      .filter(([, n]) => n > 0)
      .map(([d]) => d);
    if (touchedDates.length > 0) {
      try {
        const { fireLightTriage } = await import("./dailyTriageDispatch");
        const { fireEstimateDurations } = await import("./dailyEstimateDispatch");
        for (const d of touchedDates) {
          fireLightTriage(d);
          fireEstimateDurations(d);
        }
      } catch (err) {
        console.warn("[materialize] dispatch failed:", err);
      }
    }
  }

  return count;
}

/** Parse a week label like "Jan 6 – Jan 12" into [startISO, endISO]. */
export function parseWeekRange(
  weekLabel: string,
  referenceYear: number,
): [string, string] | null {
  const m = weekLabel.match(
    /([A-Za-z]+)\s+(\d{1,2})\s*[–\-]\s*([A-Za-z]+)\s+(\d{1,2})/,
  );
  if (!m) return null;
  const parse = (mon: string, dy: string): string | null => {
    for (const yr of [referenceYear, referenceYear + 1]) {
      const d = new Date(`${mon} ${dy}, ${yr}`);
      if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    }
    return null;
  };
  const start = parse(m[1], m[2]);
  const end = parse(m[3], m[4]);
  return start && end ? [start, end] : null;
}

/** Resolve a day label ("Monday", "Mon", "Jan 6", "2026-04-11") to an
 *  ISO date string, scoped to the parent week range when available. */
export function resolveDayDate(
  rawLabel: string,
  weekRange: [string, string] | null,
  referenceDate: Date,
): string | null {
  const label = rawLabel.trim();
  if (!label) return null;

  // ISO date: "2026-04-11"
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return label;

  // Month+day: "Jan 6", "Apr 11"
  const monthDayMatch = label.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (monthDayMatch) {
    const yr = referenceDate.getFullYear();
    for (const y of [yr, yr + 1]) {
      const d = new Date(`${monthDayMatch[1]} ${monthDayMatch[2]}, ${y}`);
      if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    }
    return null;
  }

  // Weekday name: "Monday", "Mon", etc. — resolve within week range
  if (weekRange) {
    const weekdayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const weekdayShort = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const lower = label.toLowerCase();
    let targetDay = weekdayNames.indexOf(lower);
    if (targetDay === -1) targetDay = weekdayShort.indexOf(lower);
    if (targetDay === -1) {
      // Try prefix match: "tues", "thur", etc.
      targetDay = weekdayNames.findIndex((n) => n.startsWith(lower));
    }
    if (targetDay >= 0) {
      const weekStart = new Date(weekRange[0] + "T12:00:00");
      const startDay = weekStart.getDay();
      const offset = ((targetDay - startDay) % 7 + 7) % 7;
      const resolved = new Date(weekStart);
      resolved.setDate(resolved.getDate() + offset);
      return resolved.toISOString().split("T")[0];
    }
  }

  return null;
}
