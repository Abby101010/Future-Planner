/* NorthStar server — goal plan view resolver
 *
 * Per-page aggregate for GoalPlanPage. Takes a goalId, returns the
 * hierarchical plan reconstructed from goal_plan_nodes, the goal
 * itself, the plan-chat messages, progress computations, and the
 * calendar events that might be needed for reallocation decisions.
 */

import * as repos from "../repositories";
import type {
  DailyTask,
  Goal,
  GoalPlan,
  GoalPlanMessage,
} from "@northstar/core";
import { detectPaceMismatches, type PaceMismatch } from "../services/paceDetection";
import { loadMemory, computeCapacityProfile } from "../memory";
import { getCurrentUserId } from "../middleware/requestContext";
import { getEffectiveDate, getEffectiveDaysAgo } from "../dateUtils";

export interface GoalPlanViewArgs {
  goalId: string;
}

export interface GoalPlanProgress {
  total: number;
  completed: number;
  percent: number;
}

export interface GoalPlanView {
  goal: Goal | null;
  plan: GoalPlan | null;
  planChat: GoalPlanMessage[];
  progress: GoalPlanProgress;
  /** Scheduled tasks over the plan's date range — GoalPlanPage passes
   *  these into the reallocate flow. Empty array when no plan exists. */
  scheduledTasks: DailyTask[];
  /** Pace mismatch for this specific goal (null if on track). */
  paceMismatch: PaceMismatch | null;
}

function computePlanProgress(plan: GoalPlan | null): GoalPlanProgress {
  if (!plan || !Array.isArray(plan.years)) {
    return { total: 0, completed: 0, percent: 0 };
  }
  let total = 0;
  let completed = 0;
  for (const yr of plan.years) {
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
  return {
    total,
    completed,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0,
  };
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

export async function resolveGoalPlanView(
  args: GoalPlanViewArgs,
): Promise<GoalPlanView> {
  const { goalId } = args;
  const goal = await repos.goals.get(goalId);

  if (!goal) {
    return {
      goal: null,
      plan: null,
      planChat: [],
      progress: { total: 0, completed: 0, percent: 0 },
      scheduledTasks: [],
      paceMismatch: null,
    };
  }

  // Reconstruct the nested plan from the flat goal_plan_nodes rows.
  // If the goal still has an inline `goal.plan` (legacy path), prefer the
  // reconstructed version when there are any nodes, and fall back to the
  // inline one otherwise. This way the client sees a plan either way.
  const planNodes = await repos.goalPlan.listForGoal(goalId);
  const reconstructed =
    planNodes.length > 0 ? repos.goalPlan.reconstructPlan(planNodes) : null;
  let plan: GoalPlan | null =
    reconstructed && (reconstructed.years.length > 0 || reconstructed.milestones.length > 0)
      ? reconstructed
      : (goal.plan ?? null);

  // Self-heal: if the plan has broken labels, missing durations, or
  // generic "Week 1" style labels, re-normalize using the RECONSTRUCTED
  // plan (not the stale inline goal.plan) and gap-fill the timeline.
  if (plan && Array.isArray(plan.years)) {
    const hasBrokenWeeks = plan.years.some((yr) =>
      yr.months.some((mo) => mo.weeks.length === 0),
    );
    const hasBrokenDurations = plan.years.some((yr) =>
      yr.months.some((mo) =>
        mo.weeks.some((wk) =>
          wk.days.some((dy) =>
            dy.tasks.some((t) => !t.durationMinutes),
          ),
        ),
      ),
    );
    const hasGenericLabels = plan.years.some((yr) =>
      /^year\s+\d+$/i.test(yr.label?.trim() || "") ||
      yr.months.some((mo) =>
        /^month\s+\d+$/i.test(mo.label?.trim() || "") ||
        mo.weeks.some((wk) =>
          /^week\s+\d+$/i.test(wk.label?.trim() || "") ||
          wk.days.some((dy) =>
            !dy.label || !/^\d{4}-\d{2}-\d{2}$/.test(dy.label.trim()),
          ),
        ),
      ),
    );
    if (hasBrokenWeeks || hasBrokenDurations || hasGenericLabels) {
      try {
        console.log(`[goalPlanView] self-healing plan for goal ${goalId}`);
        const startDate = goal.createdAt?.split("T")[0];
        const endDate = goal.targetDate;
        // Heal the reconstructed plan (authoritative DB data), not the inline copy
        const healed = repos.goalPlan.normalizePlan(plan, startDate, endDate);
        await repos.goalPlan.replacePlan(goalId, healed, startDate, endDate);
        plan = healed;
      } catch (err) {
        console.warn(`[goalPlanView] self-heal failed for ${goalId}:`, err);
      }
    }
  }

  const progress = computePlanProgress(plan);
  const today = todayISO();

  // Scheduled tasks: widest range we can cheaply pull — from today
  // through the goal's target date (or 90d out if no target date).
  let rangeEnd = goal.targetDate || "";
  if (!rangeEnd) {
    const d = new Date();
    d.setDate(d.getDate() + 90);
    rangeEnd = d.toISOString().split("T")[0];
  }
  const taskRecords = await repos.dailyTasks.listForDateRange(today, rangeEnd);
  const { flattenDailyTask } = await import("./_mappers");
  const scheduledTasks: DailyTask[] = taskRecords
    .filter((r) => (r.payload as Record<string, unknown>).scheduledTime)
    .map((r) => flattenDailyTask(r, r.date));

  // Pace mismatch detection for this goal — use the reconstructed plan
  // (same data the UI displays), not the inline goal.plan which may lag.
  let paceMismatch: PaceMismatch | null = null;
  try {
    const userId = getCurrentUserId();
    const [memory, userProfile] = await Promise.all([loadMemory(userId), repos.users.get()]);
    const rangeStart = getEffectiveDaysAgo(90);
    const logs = await repos.dailyLogs.list(rangeStart, today);
    const tasks = await repos.dailyTasks.listForDateRange(rangeStart, today);
    const tasksByDate = new Map<string, typeof tasks>();
    for (const t of tasks) {
      const arr = tasksByDate.get(t.date) ?? [];
      arr.push(t);
      tasksByDate.set(t.date, arr);
    }
    const logsForCapacity = logs.map((l) => {
      const dayTasks = tasksByDate.get(l.date) ?? [];
      return {
        date: l.date,
        tasks: dayTasks.map((t) => ({ completed: t.completed, skipped: false })),
      };
    });
    const capacity = computeCapacityProfile(memory, logsForCapacity, new Date(today + "T00:00:00").getDay(), undefined, userProfile?.weeklyAvailability);
    const goalForPace = plan ? { ...goal, plan } : goal;
    const mismatches = detectPaceMismatches([goalForPace], capacity.avgTasksCompletedPerDay, today);
    paceMismatch = mismatches.length > 0 ? mismatches[0] : null;
  } catch {
    // pace detection is best-effort
  }

  return {
    goal,
    plan,
    planChat: goal.planChat ?? [],
    progress,
    scheduledTasks,
    paceMismatch,
  };
}
