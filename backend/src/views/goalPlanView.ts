/* Starward server — goal plan view resolver
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
} from "@starward/core";
import { detectPaceMismatches, detectCrossGoalOverload, type PaceMismatch, type OverloadAdvisory } from "../services/paceDetection";
import { loadMemory, computeCapacityProfile } from "../memory";
import { getCurrentUserId } from "../middleware/requestContext";
import { getEffectiveDate, getEffectiveDaysAgo } from "../dateUtils";
import { findActivePlanJob, type PlanJobDescriptor } from "../job-db";

export interface GoalPlanViewArgs {
  goalId: string;
}

export interface GoalPlanProgress {
  total: number;
  completed: number;
  percent: number;
}

/** Observable state of a goal's plan. The FE should branch on these three
 *  combinations to choose what to render:
 *
 *    no plan, no job:   `plan: null, inFlight: null`
 *      → goal was created but no plan was ever requested; show "Generate plan" CTA.
 *
 *    generating:        `plan: null, inFlight: { jobId, status, startedAt }`
 *      → a `command:regenerate-goal-plan` job is pending or running;
 *        show "Planning…" skeleton with indeterminate progress.
 *
 *    ready:             `plan: { years, milestones, ... }, inFlight: null`
 *      → plan is live; render milestones, progress, tasks.
 *
 *  A plan can also be ready AND have a new job in flight (user clicked
 *  "Regenerate" on an existing plan). In that case render the existing
 *  plan with a "Regenerating…" badge rather than blowing it away. */
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
  /** Cross-goal overload advisory (null if no overload detected). */
  overloadAdvisory: OverloadAdvisory | null;
  /** In-flight `regenerate-goal-plan` job descriptor, or null if no plan
   *  job is queued/running for this goal. Populated by `findActivePlanJob`. */
  inFlight: PlanJobDescriptor | null;
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
  const userId = getCurrentUserId();
  // Look up an in-flight plan-generation job concurrently with the goal
  // fetch — it's cheap (one indexed query) and it's the FE's signal that
  // we should render a "Planning…" state even when plan is still null.
  const [goal, inFlight] = await Promise.all([
    repos.goals.get(goalId),
    findActivePlanJob(userId, goalId),
  ]);

  if (!goal) {
    return {
      goal: null,
      plan: null,
      planChat: [],
      progress: { total: 0, completed: 0, percent: 0 },
      scheduledTasks: [],
      paceMismatch: null,
      overloadAdvisory: null,
      inFlight: null,
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

  // Keep all plan nodes including locked future weeks/months — they form
  // the timeline skeleton the user expects to see. The old gap-fill
  // artifacts were cleaned from the DB directly; in-memory stripping
  // was removed because it also stripped legitimate locked stubs.

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
  let overloadAdvisory: OverloadAdvisory | null = null;
  try {
    const [memory, userProfile, allGoals] = await Promise.all([
      loadMemory(userId), repos.users.get(), repos.goals.list(),
    ]);
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
    void userProfile;
    const capacity = computeCapacityProfile(memory, logsForCapacity, new Date(today + "T00:00:00").getDay());
    const goalForPace = plan ? { ...goal, plan } : goal;
    const mismatches = detectPaceMismatches([goalForPace], capacity.avgTasksCompletedPerDay, today);
    paceMismatch = mismatches.length > 0 ? mismatches[0] : null;

    // Pace Explainer: for moderate/severe mismatches, generate AI explanation.
    // Cache in goal_plan_node payload to avoid repeated API calls.
    if (paceMismatch && (paceMismatch.severity === "moderate" || paceMismatch.severity === "severe")) {
      try {
        // Check cache: look for a pace explanation cached today
        const goalNode = planNodes.find((n) => n.nodeType === "milestone" || (n.parentId === null && n.nodeType === "year"));
        const cachedExplanation = goalNode?.payload?.paceExplanation as string | undefined;
        const cachedDate = goalNode?.payload?.paceExplanationDate as string | undefined;
        if (cachedExplanation && cachedDate === today) {
          paceMismatch.explanation = cachedExplanation;
          paceMismatch.suggestions = (goalNode?.payload?.paceSuggestions as string[] | undefined) ?? [];
        } else {
          const { getClient } = await import("../ai/client");
          const client = getClient();
          if (client) {
            const { buildMemoryContext } = await import("../memory");
            const memCtx = await buildMemoryContext(memory, "planning");
            const { handlePaceExplainer } = await import("../ai/handlers/paceExplainer");
            const result = await handlePaceExplainer(client, paceMismatch, memCtx);
            paceMismatch.explanation = result.explanation;
            paceMismatch.suggestions = result.suggestions;
            // Cache result on the first top-level node
            if (goalNode) {
              repos.goalPlan.patchNodePayload(goalNode.id, {
                paceExplanation: result.explanation,
                paceSuggestions: result.suggestions,
                paceExplanationDate: today,
              }).catch(() => {});
            }
          }
        }
      } catch {
        // pace explanation is best-effort — don't block the view
      }
    }

    // Cross-goal overload detection
    const advisories = detectCrossGoalOverload(
      allGoals, capacity.avgTasksCompletedPerDay,
      capacity.maxDailyTasks ?? 5, today,
    );
    overloadAdvisory = advisories.find((a) => a.goalId === goalId) ?? null;
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
    overloadAdvisory,
    inFlight,
  };
}
