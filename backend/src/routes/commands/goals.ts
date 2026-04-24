/**
 * Goal-related command handlers.
 */

import type { GoalPlan } from "@starward/core";
import { repos } from "./_helpers";
import { onGoalConfirmed } from "../../coordinators/bigGoalCoordinator";
import { materializePlanTasks } from "../../services/planMaterialization";

/**
 * Create / upsert a goal row.
 *
 * ⚠  **Pure upsert — does NOT generate a plan.** Callers that want a plan
 * must enqueue `command:regenerate-goal-plan` as a separate second call
 * (the FE chat-confirm and "New goal" flows do this explicitly). The
 * async plan job will then call `cmdRegenerateGoalPlan` in the worker
 * and set `goal.plan`, `goal.planConfirmed`, and emit
 * `view:invalidate[view:goal-plan, view:planning, view:dashboard]`.
 *
 * Why separate commands: creating a goal and generating a plan are two
 * distinct operations with different cost profiles (upsert vs. 30s LLM
 * job). Some callers — imports, test harnesses, the onboarding
 * confirm-onboarding-goal path — create a goal WITHOUT wanting a plan
 * kicked off from this handler. Keeping create pure avoids surprise
 * duplicate jobs.
 *
 * Body shape: `{ goal: { id, title, ... } }` — the FE must generate the
 * goal id (client-side UUID is fine; see PlanningPage.createGoal /
 * FloatingChat's PendingGoalCard).
 */
export async function cmdCreateGoal(
  body: Record<string, unknown>,
): Promise<unknown> {
  const goal = body.goal as Parameters<typeof repos.goals.upsert>[0];
  if (!goal || typeof goal !== "object" || !(goal as { id?: string }).id) {
    throw new Error("command:create-goal requires args.goal with an id");
  }
  await repos.goals.upsert(goal);
  return { ok: true, goalId: goal.id };
}

export async function cmdUpdateGoal(
  body: Record<string, unknown>,
): Promise<unknown> {
  const goal = body.goal as Parameters<typeof repos.goals.upsert>[0];
  if (!goal || typeof goal !== "object" || !(goal as { id?: string }).id) {
    throw new Error("command:update-goal requires args.goal with an id");
  }
  await repos.goals.upsert(goal);
  return { ok: true, goalId: goal.id };
}

export async function cmdDeleteGoal(
  body: Record<string, unknown>,
): Promise<unknown> {
  const goalId = body.goalId as string | undefined;
  if (!goalId) throw new Error("command:delete-goal requires args.goalId");
  await repos.goalPlan.deleteForGoal(goalId);
  await repos.goals.remove(goalId);
  return { ok: true, goalId };
}

// ── A-5: goal pause / resume ────────────────────────────────

export async function cmdPauseGoal(
  body: Record<string, unknown>,
): Promise<unknown> {
  const goalId = body.goalId as string | undefined;
  if (!goalId) throw new Error("command:pause-goal requires args.goalId");
  const existing = await repos.goals.get(goalId);
  if (!existing) throw new Error(`goal ${goalId} not found`);
  if (existing.status === "paused") {
    return { ok: true, goalId, noop: true };
  }
  await repos.goals.upsert({ ...existing, status: "paused" });
  return { ok: true, goalId };
}

export async function cmdResumeGoal(
  body: Record<string, unknown>,
): Promise<unknown> {
  const goalId = body.goalId as string | undefined;
  if (!goalId) throw new Error("command:resume-goal requires args.goalId");
  const existing = await repos.goals.get(goalId);
  if (!existing) throw new Error(`goal ${goalId} not found`);
  if (existing.status !== "paused") {
    return { ok: true, goalId, noop: true };
  }
  await repos.goals.upsert({ ...existing, status: "active" });
  return { ok: true, goalId };
}

export async function cmdConfirmGoalPlan(
  body: Record<string, unknown>,
): Promise<unknown> {
  const goalId = body.goalId as string | undefined;
  if (!goalId) throw new Error("command:confirm-goal-plan requires args.goalId");
  const existing = await repos.goals.get(goalId);
  if (!existing) throw new Error(`goal ${goalId} not found`);
  await repos.goals.upsert({ ...existing, planConfirmed: true });

  // Seed an initial pace snapshot from the plan itself so the FE has a
  // numeric value to render before any completion data arrives. Phase G
  // adaptive-reschedule pass replaces this with the actual measured pace.
  const plannedPace = computePlannedTasksPerDay(existing.plan, existing.targetDate);
  if (plannedPace !== null) {
    await repos.goals.setPaceSnapshot(goalId, plannedPace);
  }

  // Materialize plan tasks into daily_tasks for the next 14 days.
  // These become pre-committed future tasks the Daily Planner respects.
  const materialized = await materializePlanTasks(goalId, existing.plan);

  // Save Project Agent Context so follow-up conversations have
  // research / personalization data without re-processing from scratch.
  // The chat messages live on goal.planChat (shown in UI);
  // this saves the AI's working memory (research, capacity profile, decisions).
  try {
    const decisions = (existing.planChat ?? [])
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .slice(-5);
    await onGoalConfirmed(goalId, null, null, decisions);
  } catch (err) {
    console.warn("[confirm-goal-plan] save project context failed:", err);
  }

  return { ok: true, goalId, materializedCount: materialized };
}

// ── Plan task materialization ────────────────────────────────

/** Baseline pace: total tasks in the plan divided by days remaining to
 *  the target date. Returns `null` when either is unknown or
 *  non-positive. The adaptive-reschedule job replaces this with the
 *  measured actual pace once completion data starts flowing. */
function computePlannedTasksPerDay(
  plan: GoalPlan | null,
  targetDate: string,
): number | null {
  if (!plan || !Array.isArray(plan.years) || !targetDate) return null;
  let total = 0;
  for (const y of plan.years) {
    for (const m of y.months) {
      for (const w of m.weeks) {
        for (const d of w.days) {
          total += d.tasks.length;
        }
      }
    }
  }
  const target = new Date(targetDate);
  const today = new Date();
  if (isNaN(target.getTime())) return null;
  const daysRemaining = Math.max(
    1,
    Math.round((target.getTime() - today.getTime()) / 86400000),
  );
  if (total <= 0) return null;
  return Math.round((total / daysRemaining) * 100) / 100;
}

