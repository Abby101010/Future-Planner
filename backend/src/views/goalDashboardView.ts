/* Starward server — goal dashboard view resolver (Phase 5)
 *
 * Per-goal Dashboard data source. Composes:
 *   - goal (from goals repo)
 *   - milestones (reconstructed from goal_plan_nodes)
 *   - progress (DashboardProgressData — task + milestone counters)
 *   - insightCards (from dashboardInsightAgent via RAG retrieval)
 *   - recentActivity (recent daily logs; optional)
 *   - aiObservations (proactive AI notes; seeded empty, populated later)
 *
 * No hardcoded goal-type branching — all intelligence comes from the
 * retrieval-driven insight agent.
 */

import * as repos from "../repositories";
import type {
  AIObservation,
  DashboardProgressData,
  Goal,
  GoalPlan,
  GoalPlanMilestone,
  InsightCard,
} from "@starward/core";
import { generateInsightCards } from "../agents/dashboardInsightAgent";
import { estimatePlanProgress } from "../services/planProgress";

export interface GoalDashboardViewArgs {
  goalId: string;
}

/** Compact per-day activity row. We keep this deliberately small instead of
 *  embedding the full DailyLog so the view payload stays lean. The FE can
 *  render a simple recent-days strip from this shape. */
export interface GoalDashboardActivity {
  date: string;
  completed: boolean;
  reflection: string | null;
}

export interface GoalDashboardView {
  goal: Goal | null;
  milestones: GoalPlanMilestone[];
  progress: DashboardProgressData;
  insightCards: InsightCard[];
  recentActivity: GoalDashboardActivity[];
  aiObservations: AIObservation[];
}

function emptyProgress(): DashboardProgressData {
  return {
    completedTasks: 0,
    totalTasks: 0,
    percent: 0,
    currentMilestoneIndex: 0,
    totalMilestones: 0,
    projectedCompletion: "",
    status: "on-track",
  };
}

function computeProgress(plan: GoalPlan | null, goal: Goal): DashboardProgressData {
  if (!plan) {
    return {
      ...emptyProgress(),
      projectedCompletion: goal.targetDate ?? "",
    };
  }

  // Delegates to the shared estimator so Dashboard reports the same
  // projected total (materialized + locked-week extrapolation) as
  // Planning and Goal-Plan. See services/planProgress.ts.
  const { completed: completedTasks, projectedTotal: totalTasks, percent } =
    estimatePlanProgress(plan);

  const milestones = plan.milestones ?? [];
  const currentIdx = milestones.findIndex((m) => !m.completed);
  const currentMilestoneIndex = currentIdx === -1 ? milestones.length : currentIdx;

  // Naive status heuristic: compare today vs. plan's projected completion.
  // More sophisticated pace logic lives in paceDetection; that signal will
  // flow through insightCards / aiObservations later.
  let status: DashboardProgressData["status"] = "on-track";
  if (goal.targetDate) {
    const today = new Date();
    const target = new Date(goal.targetDate);
    const totalDays = Math.max(
      1,
      Math.round((target.getTime() - new Date(goal.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
    );
    const elapsedDays = Math.max(
      0,
      Math.round((today.getTime() - new Date(goal.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
    );
    const elapsedPercent = Math.min(100, Math.round((elapsedDays / totalDays) * 100));
    if (percent >= elapsedPercent + 10) status = "ahead";
    else if (percent <= elapsedPercent - 15) status = "behind";
  }

  return {
    completedTasks,
    totalTasks,
    percent,
    currentMilestoneIndex,
    totalMilestones: milestones.length,
    projectedCompletion: goal.targetDate ?? "",
    status,
  };
}

export async function resolveGoalDashboardView(
  args: GoalDashboardViewArgs,
): Promise<GoalDashboardView> {
  const { goalId } = args;
  const goal = await repos.goals.get(goalId);
  if (!goal) {
    return {
      goal: null,
      milestones: [],
      progress: emptyProgress(),
      insightCards: [],
      recentActivity: [],
      aiObservations: [],
    };
  }

  // Reconstruct plan from goal_plan_nodes (authoritative) or fall back to
  // legacy inline plan. Same pattern as goalPlanView.
  const planNodes = await repos.goalPlan.listForGoal(goalId);
  const reconstructed =
    planNodes.length > 0 ? repos.goalPlan.reconstructPlan(planNodes) : null;
  const plan: GoalPlan | null =
    reconstructed && (reconstructed.years.length > 0 || reconstructed.milestones.length > 0)
      ? reconstructed
      : (goal.plan ?? null);

  const milestones = plan?.milestones ?? [];
  const progress = computeProgress(plan, goal);

  // Ask the dashboardInsightAgent for the card mix. Failures fall back to
  // safe generic cards inside the agent — view never throws.
  const { cards } = await generateInsightCards({ goal });

  // Recent activity: last 7 daily logs mapped to a compact per-day row.
  let recentActivity: GoalDashboardActivity[] = [];
  try {
    const today = new Date().toISOString().split("T")[0];
    const start = new Date();
    start.setDate(start.getDate() - 7);
    const startISO = start.toISOString().split("T")[0];
    const records = await repos.dailyLogs.list(startISO, today);
    recentActivity = records.map((r) => ({
      date: r.date,
      completed: Boolean((r.payload as Record<string, unknown>).tasksConfirmed),
      reflection: r.reflection ?? null,
    }));
  } catch (err) {
    console.error("[goal-dashboard] dailyLogs fetch failed:", err);
  }

  // aiObservations intentionally seeded empty here. A future pass will
  // surface pace-mismatch / overload notes from the detectors; keeping
  // the field present so the FE contract is stable from day one.
  const aiObservations: AIObservation[] = [];

  return {
    goal,
    milestones,
    progress,
    insightCards: cards,
    recentActivity,
    aiObservations,
  };
}
