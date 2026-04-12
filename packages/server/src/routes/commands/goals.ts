/**
 * Goal-related command handlers.
 */

import { repos } from "./_helpers";

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

export async function cmdConfirmGoalPlan(
  body: Record<string, unknown>,
): Promise<unknown> {
  const goalId = body.goalId as string | undefined;
  if (!goalId) throw new Error("command:confirm-goal-plan requires args.goalId");
  const existing = await repos.goals.get(goalId);
  if (!existing) throw new Error(`goal ${goalId} not found`);
  await repos.goals.upsert({ ...existing, planConfirmed: true });
  return { ok: true, goalId };
}

