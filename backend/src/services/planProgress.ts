/* Plan progress estimator.
 *
 * Single source of truth for plan-level progress counters. Previously
 * three view resolvers (planningView, goalPlanView, goalDashboardView)
 * each had their own flat counting loop that summed
 * `plan.years[].months[].weeks[].days[].tasks` — which undercounts
 * because the planner only emits day-level tasks for the first ~2
 * unlocked weeks (token-budget decision). Every later week is
 * `locked: true` with `days: []`, contributing 0. A 12-week × 3/wk
 * goal would report `Tasks done 0/6` instead of `0/36`.
 *
 * This helper fixes that by extrapolating task load across locked
 * weeks, and is the single function every progress-consuming view
 * should call. If you find yourself writing another
 * `for (const yr of plan.years)` loop in a view resolver, call this
 * instead.
 *
 * Extrapolation contract:
 *   - `materialized` counts only what the planner actually emitted.
 *   - `completed` counts `completed: true` within materialized.
 *   - `projectedTotal = materialized + (avgTasksPerUnlockedWeek × lockedWeekCount)`.
 *   - If no unlocked weeks exist (nothing to average from), we refuse
 *     to extrapolate and return `projectedTotal = 0`. UI renders
 *     "0/0" or "pending" — honest, better than a fabricated number.
 *   - `percent = round(completed / projectedTotal × 100)`; 0 when
 *     projectedTotal is 0.
 */

import type { GoalPlan } from "@starward/core";

export interface PlanProgressEstimate {
  /** Completed tasks (subset of materialized). */
  completed: number;
  /** Tasks actually emitted by the planner so far (unlocked weeks only). */
  materialized: number;
  /** Total tasks projected across the full goal horizon. Materialized
   *  tasks + extrapolated load for locked weeks. 0 when nothing has
   *  been materialized yet. */
  projectedTotal: number;
  /** Completion percent 0–100. Integer. 0 when projectedTotal is 0. */
  percent: number;
}

export function estimatePlanProgress(plan: GoalPlan | null): PlanProgressEstimate {
  if (!plan || !Array.isArray(plan.years)) {
    return { completed: 0, materialized: 0, projectedTotal: 0, percent: 0 };
  }

  let materialized = 0;
  let completed = 0;
  let unlockedWeekCount = 0;
  let lockedWeekCount = 0;

  for (const yr of plan.years) {
    for (const mo of yr.months ?? []) {
      for (const wk of mo.weeks ?? []) {
        if (wk.locked) {
          lockedWeekCount++;
          continue;
        }
        unlockedWeekCount++;
        for (const dy of wk.days ?? []) {
          for (const tk of dy.tasks ?? []) {
            materialized++;
            if (tk.completed) completed++;
          }
        }
      }
    }
  }

  // Extrapolate only when we have at least one unlocked week to learn
  // from. Otherwise projectedTotal stays at materialized (0 when no
  // week has been emitted yet) — we don't invent numbers.
  const avgPerUnlockedWeek =
    unlockedWeekCount > 0 ? materialized / unlockedWeekCount : 0;
  const extrapolated = Math.round(avgPerUnlockedWeek * lockedWeekCount);
  const projectedTotal = materialized + extrapolated;

  const percent =
    projectedTotal > 0 ? Math.round((completed / projectedTotal) * 100) : 0;

  return { completed, materialized, projectedTotal, percent };
}
