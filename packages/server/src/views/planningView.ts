/* NorthStar server — planning view resolver
 *
 * Narrow per-page aggregate for PlanningPage. The page renders a list
 * of goals (grouped by goalType), a MonthlyContext editor, and an
 * agent-progress overlay. We return everything it needs in one shot.
 */

import * as repos from "../repositories";
import type { Goal, MonthlyContext } from "@northstar/core";

export interface PlanningView {
  goals: Goal[];
  monthlyContexts: MonthlyContext[];
  currentMonthContext: MonthlyContext | null;
  /** Goals whose plan has not been confirmed yet — PlanningPage surfaces
   *  these in a dedicated "needs review" list. */
  goalsNeedingPlanReview: Goal[];
}

function currentMonthKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export async function resolvePlanningView(): Promise<PlanningView> {
  const [goals, monthlyContexts] = await Promise.all([
    repos.goals.list(),
    repos.monthlyContext.list(),
  ]);

  const monthKey = currentMonthKey();
  const currentMonthContext =
    monthlyContexts.find((c) => c.month === monthKey) ?? null;

  const goalsNeedingPlanReview = goals.filter(
    (g) =>
      (g.goalType === "big" || (!g.goalType && g.scope === "big")) &&
      g.status !== "archived" &&
      !g.planConfirmed,
  );

  return {
    goals,
    monthlyContexts,
    currentMonthContext,
    goalsNeedingPlanReview,
  };
}
