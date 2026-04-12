/* NorthStar server — goal plan view resolver
 *
 * Per-page aggregate for GoalPlanPage. Takes a goalId, returns the
 * hierarchical plan reconstructed from goal_plan_nodes, the goal
 * itself, the plan-chat messages, a small set of progress/overdue
 * computations, and the calendar events that might be needed for
 * reallocation decisions.
 *
 * Computed server-side (client stays zero-logic):
 *   - taskCount / completedCount / percent
 *   - overdueTaskCount (tasks whose parent day is in the past and
 *     that are not yet complete)
 *   - needsRescheduling (boolean: > 0 overdue AND not dismissed)
 */

import * as repos from "../repositories";
import type {
  CalendarEvent,
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
  /** Number of incomplete tasks that sit on a day before today. */
  overdueTaskCount: number;
  /** True when there are overdue tasks AND the user hasn't dismissed
   *  the reschedule banner yet. */
  needsRescheduling: boolean;
  /** Calendar events over the plan's date range — GoalPlanPage passes
   *  these into the reallocate flow. Empty array when no plan exists. */
  calendarEvents: CalendarEvent[];
  /** Pace mismatch for this specific goal (null if on track). */
  paceMismatch: PaceMismatch | null;
}

function isDateBefore(dateStr: string, today: string): boolean {
  if (!dateStr) return false;
  return dateStr.localeCompare(today) < 0;
}

function computeOverdueFromPlan(plan: GoalPlan, today: string): number {
  let overdue = 0;
  for (const yr of plan.years ?? []) {
    for (const mo of yr.months) {
      for (const wk of mo.weeks) {
        for (const dy of wk.days) {
          // day.label can be "Mon" / "2026-04-10" / "Apr 10" — we can't
          // reliably parse free-form labels, so we rely on the week
          // being locked as a cheap proxy. If the week is locked AND a
          // task is incomplete we count it overdue.
          if (!wk.locked) continue;
          for (const tk of dy.tasks) {
            if (!tk.completed) overdue++;
          }
        }
      }
    }
  }
  void today;
  return overdue;
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
      overdueTaskCount: 0,
      needsRescheduling: false,
      calendarEvents: [],
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
  const plan: GoalPlan | null =
    reconstructed && (reconstructed.years.length > 0 || reconstructed.milestones.length > 0)
      ? reconstructed
      : (goal.plan ?? null);

  const progress = computePlanProgress(plan);
  const today = todayISO();
  const overdueTaskCount = plan ? computeOverdueFromPlan(plan, today) : 0;
  const needsRescheduling =
    overdueTaskCount > 0 && !goal.rescheduleBannerDismissed;

  // Calendar events: widest range we can cheaply pull — from today
  // through the goal's target date (or 90d out if no target date).
  let rangeEnd = goal.targetDate || "";
  if (!rangeEnd) {
    const d = new Date();
    d.setDate(d.getDate() + 90);
    rangeEnd = d.toISOString().split("T")[0];
  }
  const calendarEvents = await repos.calendar.listForRange(
    `${today}T00:00:00`,
    `${rangeEnd}T23:59:59`,
  );

  // Pace mismatch detection for this goal — use the reconstructed plan
  // (same data the UI displays), not the inline goal.plan which may lag.
  let paceMismatch: PaceMismatch | null = null;
  try {
    const userId = getCurrentUserId();
    const memory = await loadMemory(userId);
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
    const capacity = computeCapacityProfile(memory, logsForCapacity, new Date(today + "T00:00:00").getDay());
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
    overdueTaskCount,
    needsRescheduling,
    calendarEvents,
    paceMismatch,
  };
}
