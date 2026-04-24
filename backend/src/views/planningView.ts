/* Starward server — planning view resolver
 *
 * Narrow per-page aggregate for PlanningPage. The page renders a list
 * of goals (grouped by goalType), a MonthlyContext editor, and an
 * agent-progress overlay. We return everything it needs in one shot —
 * including the per-group splits and per-big-goal plan progress —
 * so the page has zero domain logic.
 */

import * as repos from "../repositories";
import type { Goal, MonthlyContext, GoalPlanMilestone } from "@starward/core";
import { findActivePlanJobsByUser, type PlanJobDescriptor } from "../job-db";
import { getCurrentUserId } from "../middleware/requestContext";

export interface PlanProgress {
  completed: number;
  total: number;
  percent: number;
}

/** Mirrors frontend/src/pages/goals/PaceBadge.tsx `Pace` union. Kept as a
 *  string union so the backend doesn't have to import FE types. */
export type Pace = "on-track" | "ahead" | "behind" | "paused";

/** A goal plus any in-flight plan-generation descriptor. Kept as an
 *  intersection so existing callers that read `Goal` fields still work,
 *  while new FE code can branch on `inFlight != null` to render a
 *  "Planning…" pill in place of the pace badge. Null when no
 *  `regenerate-goal-plan` job is queued or running for this goal.
 *
 *  Also carries the FE-facing card fields (pace/paceDelta/pct/etc.) so
 *  GoalCard can render without any derivation on the client. Pace is
 *  always populated; defaults to "on-track" when no mismatch is detected. */
export type PlanningGoal = Goal & {
  inFlight: PlanJobDescriptor | null;
  pace: Pace;
  paceDelta?: string;
  pct?: number;
  horizon?: string;
  nextMilestone?: string;
  nextDue?: string | null;
  openTasks?: number;
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

/** Derive pace for a goal from its status alone, as a safe default. Phase G
 *  will replace this with a real pace snapshot persisted on `goals`. */
function derivePace(goal: Goal): Pace {
  if (goal.status === "paused") return "paused";
  return "on-track";
}

/** Format a goal's target date as a human horizon string (e.g. "12 months").
 *  Returns undefined for habits / targetless goals so the FE pill hides. */
function deriveHorizon(goal: Goal): string | undefined {
  if (!goal.targetDate) return undefined;
  const target = new Date(goal.targetDate);
  const start = new Date(goal.createdAt || new Date().toISOString());
  if (isNaN(target.getTime()) || isNaN(start.getTime())) return undefined;
  const days = Math.max(1, Math.round((target.getTime() - start.getTime()) / 86400000));
  if (days < 14) return `${days}d`;
  if (days < 90) return `${Math.round(days / 7)}wk`;
  if (days < 730) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}

/** Next incomplete milestone title + target date from the reconstructed plan. */
function deriveNextMilestone(goal: Goal): { title?: string; due?: string } {
  const ms: GoalPlanMilestone[] = goal.plan?.milestones ?? [];
  const next = ms.find((m) => !m.completed);
  return { title: next?.title, due: next?.targetDate };
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

  // Annotate every goal with an `inFlight` descriptor (or null) plus the
  // card-render fields the FE PlanningGoal expects (pace, paceDelta, pct,
  // horizon, nextMilestone, nextDue, openTasks). Pace defaults to
  // "on-track" — Phase G will replace this with a real snapshot. Every
  // downstream split below operates on PlanningGoal so the FE receives a
  // consistent shape regardless of which filter bucket a goal lands in.
  const goals: PlanningGoal[] = rawGoals.map((g) => {
    const progress = planProgress(g);
    const next = deriveNextMilestone(g);
    return {
      ...g,
      inFlight: inFlightByGoalId.get(g.id) ?? null,
      pace: derivePace(g),
      pct: progress.total > 0 ? progress.percent : undefined,
      horizon: deriveHorizon(g),
      nextMilestone: next.title,
      nextDue: next.due ?? null,
      openTasks: progress.total - progress.completed,
    };
  });

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
