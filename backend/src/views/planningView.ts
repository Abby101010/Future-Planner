/* Starward server — planning view resolver
 *
 * Narrow per-page aggregate for PlanningPage. The page renders a list
 * of goals (grouped by goalType), a MonthlyContext editor, and an
 * agent-progress overlay. We return everything it needs in one shot —
 * including the per-group splits and per-big-goal plan progress —
 * so the page has zero domain logic.
 */

import * as repos from "../repositories";
import type { Goal, MonthlyContext } from "@starward/core";
import { findActivePlanJobsByUser, type PlanJobDescriptor } from "../job-db";
import { getCurrentUserId } from "../middleware/requestContext";

export interface PlanProgress {
  completed: number;
  total: number;
  percent: number;
}

/** A goal plus any in-flight plan-generation descriptor. Kept as an
 *  intersection so existing callers that read `Goal` fields still work,
 *  while new FE code can branch on `inFlight != null` to render a
 *  "Planning…" pill in place of the pace badge. Null when no
 *  `regenerate-goal-plan` job is queued or running for this goal. */
export type PlanningGoal = Goal & {
  inFlight: PlanJobDescriptor | null;
};

export interface PlanningView {
  goals: PlanningGoal[];
  monthlyContexts: MonthlyContext[];
  currentMonthContext: MonthlyContext | null;
  /** Goals whose plan has not been confirmed yet — PlanningPage surfaces
   *  these in a dedicated "needs review" list. */
  goalsNeedingPlanReview: PlanningGoal[];
  bigGoals: PlanningGoal[];
  everydayGoals: PlanningGoal[];
  repeatingGoals: PlanningGoal[];
  /** Per-goal plan progress keyed by goal id. Empty map entry means the
   *  goal has no plan yet; the page renders a 0% bar. */
  bigGoalProgressById: Record<string, PlanProgress>;
}

function currentMonthKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function planProgress(goal: Goal): PlanProgress {
  let total = 0;
  let completed = 0;
  if (goal.plan && Array.isArray(goal.plan.years)) {
    for (const yr of goal.plan.years) {
      for (const mo of yr.months) {
        for (const wk of mo.weeks) {
          for (const dy of wk.days) {
            for (const tk of dy.tasks) {
              total++;
              if (tk.completed) completed++;
            }
          }
        }
      }
    }
  }
  return {
    completed,
    total,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}

export async function resolvePlanningView(): Promise<PlanningView> {
  const userId = getCurrentUserId();
  // `findActivePlanJobsByUser` runs a single indexed query returning a map
  // of goalId → in-flight descriptor. Fetching alongside goals + monthly
  // contexts keeps the view to three parallel DB round-trips.
  const [rawGoals, monthlyContexts, inFlightByGoalId] = await Promise.all([
    repos.goals.list(),
    repos.monthlyContext.list(),
    findActivePlanJobsByUser(userId),
  ]);

  // Annotate every goal with an `inFlight` descriptor (or null). Every
  // downstream split below operates on PlanningGoal so the FE receives a
  // consistent shape regardless of which filter bucket a goal lands in.
  const goals: PlanningGoal[] = rawGoals.map((g) => ({
    ...g,
    inFlight: inFlightByGoalId.get(g.id) ?? null,
  }));

  const monthKey = currentMonthKey();
  const currentMonthContext =
    monthlyContexts.find((c) => c.month === monthKey) ?? null;

  const goalsNeedingPlanReview = goals.filter(
    (g) =>
      (g.goalType === "big" || (!g.goalType && g.scope === "big")) &&
      g.status !== "archived" &&
      !g.planConfirmed,
  );

  const bigGoals = goals.filter(
    (g) => g.goalType === "big" && g.status !== "archived",
  );
  const everydayGoals = goals.filter(
    (g) =>
      (g.goalType === "everyday" || (!g.goalType && g.scope === "small")) &&
      g.status !== "archived" &&
      g.status !== "completed",
  );
  const repeatingGoals = goals.filter(
    (g) => g.goalType === "repeating" && g.status !== "archived",
  );

  const bigGoalProgressById: Record<string, PlanProgress> = {};
  for (const g of bigGoals) {
    bigGoalProgressById[g.id] = planProgress(g);
  }

  return {
    goals,
    monthlyContexts,
    currentMonthContext,
    goalsNeedingPlanReview,
    bigGoals,
    everydayGoals,
    repeatingGoals,
    bigGoalProgressById,
  };
}
