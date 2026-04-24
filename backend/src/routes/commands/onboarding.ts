/**
 * Onboarding command handlers (backend complete; UI pending).
 *
 * Five commands that drive the conversational 7-step onboarding flow.
 * The user-facing steps (welcome, signup, discovery, goal-naming,
 * clarification, plan-reveal, first-task, complete) are computed
 * server-side from user payload state in view:onboarding — these
 * commands just advance that state.
 *
 *   1. send-onboarding-message      — conversational turn + memory writes
 *   2. propose-onboarding-goal      — run summarizer, persist proposedGoal
 *   3. confirm-onboarding-goal      — create Goal row from proposal/edits
 *   4. accept-onboarding-plan       — set planConfirmed on the goal
 *   5. commit-first-task            — seed today's first task; complete onboarding
 */

import crypto from "node:crypto";
import type {
  Goal,
  GoalPlan,
  GoalPlanTask,
  OnboardingMessage,
  OnboardingStep,
  ProposedOnboardingGoal,
} from "@starward/core";
import { repos, getCurrentUserId } from "./_helpers";
import {
  saveOnboardingFact,
  saveOnboardingPreference,
  recordOnboardingSignal,
  loadMemory,
} from "../../memory";
import { runOnboardingDiscovery } from "../../agents/onboardingDiscovery";
import { proposeOnboardingGoal } from "../../agents/onboardingSummarizer";

// Onboarding state keys on the user payload jsonb column. Kept narrow and
// explicit so future migrations / cleanup can target them.
type OnboardingPayloadKey =
  | "onboardingStep"
  | "onboardingMessages"
  | "proposedGoal"
  | "onboardingGoalId"
  | "onboardingFirstTaskId";

interface OnboardingPayload {
  onboardingStep?: OnboardingStep;
  onboardingMessages?: OnboardingMessage[];
  proposedGoal?: ProposedOnboardingGoal;
  onboardingGoalId?: string;
  onboardingFirstTaskId?: string;
}

async function readOnboardingPayload(): Promise<OnboardingPayload> {
  const user = await repos.users.get();
  if (!user) return {};
  const withPayload = user as unknown as OnboardingPayload;
  return {
    onboardingStep: withPayload.onboardingStep,
    onboardingMessages: withPayload.onboardingMessages,
    proposedGoal: withPayload.proposedGoal,
    onboardingGoalId: withPayload.onboardingGoalId,
    onboardingFirstTaskId: withPayload.onboardingFirstTaskId,
  };
}

async function writeOnboardingPayload(
  patch: Partial<Record<OnboardingPayloadKey, unknown>>,
): Promise<void> {
  await repos.users.updatePayload(patch);
}

// ── 1. send-onboarding-message ───────────────────────────────

export async function cmdSendOnboardingMessage(
  body: Record<string, unknown>,
): Promise<unknown> {
  const message = body.message as string | undefined;
  if (!message || typeof message !== "string" || !message.trim()) {
    throw new Error("command:send-onboarding-message requires args.message (non-empty string)");
  }

  const userId = getCurrentUserId();
  const payload = await readOnboardingPayload();
  const prior = payload.onboardingMessages ?? [];

  // Run discovery agent.
  const result = await runOnboardingDiscovery({
    priorMessages: prior,
    userMessage: message.trim(),
  });

  // Persist extractions to the memory tables. Failures here must not break
  // the conversation — the user has already typed a reply, they expect an
  // assistant response regardless.
  for (const fact of result.extractions.facts) {
    try {
      await saveOnboardingFact(userId, fact.category, fact.key, fact.value, fact.evidence);
    } catch (err) {
      console.error("[onboarding] saveFact failed:", err);
    }
  }
  for (const pref of result.extractions.preferences) {
    try {
      await saveOnboardingPreference(userId, pref.text, pref.tags, pref.example);
    } catch (err) {
      console.error("[onboarding] savePreference failed:", err);
    }
  }
  for (const sig of result.extractions.signals) {
    try {
      await recordOnboardingSignal(userId, sig.type, sig.context, sig.value);
    } catch (err) {
      console.error("[onboarding] recordSignal failed:", err);
    }
  }

  // Append both the user message and the AI reply to the conversation.
  const nowIso = new Date().toISOString();
  const newMessages: OnboardingMessage[] = [
    ...prior,
    { role: "user", content: message.trim(), timestamp: nowIso },
    { role: "assistant", content: result.reply, timestamp: new Date().toISOString() },
  ];

  // Step transition: if AI signals shouldConclude, hand off to goal-naming.
  // Otherwise stay in discovery (or enter it from welcome).
  const nextStep: OnboardingStep = result.shouldConclude ? "goal-naming" : "discovery";

  await writeOnboardingPayload({
    onboardingMessages: newMessages,
    onboardingStep: nextStep,
  });

  return {
    ok: true,
    reply: result.reply,
    shouldConclude: result.shouldConclude,
    step: nextStep,
    extractionsCount: {
      facts: result.extractions.facts.length,
      preferences: result.extractions.preferences.length,
      signals: result.extractions.signals.length,
    },
  };
}

// ── 2. propose-onboarding-goal ───────────────────────────────

export async function cmdProposeOnboardingGoal(
  _body: Record<string, unknown>,
): Promise<unknown> {
  void _body;
  const userId = getCurrentUserId();
  const payload = await readOnboardingPayload();
  const messages = payload.onboardingMessages ?? [];
  if (messages.length === 0) {
    throw new Error("command:propose-onboarding-goal requires prior conversation (use send-onboarding-message first)");
  }

  const memory = await loadMemory(userId);
  const result = await proposeOnboardingGoal({
    messages,
    facts: memory.facts,
    preferences: memory.preferences,
  });

  await writeOnboardingPayload({
    proposedGoal: result.proposedGoal,
    onboardingStep: "goal-naming",
  });

  return { ok: true, proposedGoal: result.proposedGoal };
}

// ── 3. confirm-onboarding-goal ───────────────────────────────

export async function cmdConfirmOnboardingGoal(
  body: Record<string, unknown>,
): Promise<unknown> {
  // Accept the edited goal the user confirmed. Title is required; everything
  // else falls back to the proposed values if omitted.
  const title = body.title as string | undefined;
  if (!title || typeof title !== "string" || !title.trim()) {
    throw new Error("command:confirm-onboarding-goal requires args.title");
  }

  const payload = await readOnboardingPayload();
  const proposed = payload.proposedGoal;

  const description = (body.description as string | undefined) ?? proposed?.description ?? "";
  const targetDate = (body.targetDate as string | undefined) ?? proposed?.targetDate ?? "";
  const hoursPerWeek = (body.hoursPerWeek as number | undefined) ?? proposed?.hoursPerWeek ?? 5;
  const metadata = (body.metadata as Record<string, unknown> | undefined)
    ?? proposed?.metadata
    ?? {};
  const goalDescription = (body.goalDescription as string | undefined)
    ?? proposed?.description
    ?? title.trim();

  const goalId = crypto.randomUUID();
  const now = new Date().toISOString();
  const newGoal: Goal = {
    id: goalId,
    title: title.trim(),
    description,
    targetDate,
    isHabit: false,
    importance: "medium",
    scope: "big",
    goalType: "big",
    status: "planning",
    createdAt: now,
    updatedAt: now,
    planChat: [],
    plan: null,
    flatPlan: null,
    planConfirmed: false,
    scopeReasoning: "",
    repeatSchedule: null,
    goalDescription,
    goalMetadata: {
      ...(metadata as Record<string, unknown>),
      hoursPerWeek,
      fromOnboarding: true,
    },
    userNotes: "",
    clarificationAnswers: {},
    // 0013 methodology fields — hours budget seeds from onboarding;
    // everything else starts empty and is filled in by the planner.
    weeklyHoursTarget: typeof hoursPerWeek === "number" ? hoursPerWeek : undefined,
    funnelMetrics: {},
    skillMap: {},
    laborMarketData: {},
    overrideLog: [],
  };

  await repos.goals.upsert(newGoal);

  await writeOnboardingPayload({
    onboardingGoalId: goalId,
    onboardingStep: "clarification",
  });

  return { ok: true, goalId };
}

// ── 4. accept-onboarding-plan ────────────────────────────────

export async function cmdAcceptOnboardingPlan(
  body: Record<string, unknown>,
): Promise<unknown> {
  // Accepts the plan the user saw in the plan-reveal step. Caller may pass
  // { goalId } explicitly or we fall back to the onboarding goal id on the
  // payload. Expects the goal to already have a plan (set via the existing
  // generate-goal-plan / regenerate-goal-plan flow, or via goal-plan-chat
  // stream). We just flip planConfirmed and advance to first-task.
  const payload = await readOnboardingPayload();
  const goalId = (body.goalId as string | undefined) ?? payload.onboardingGoalId;
  if (!goalId) {
    throw new Error("command:accept-onboarding-plan requires args.goalId (or prior confirm-onboarding-goal)");
  }

  const existing = await repos.goals.get(goalId);
  if (!existing) throw new Error(`goal ${goalId} not found`);

  await repos.goals.upsert({
    ...existing,
    planConfirmed: true,
    status: "active",
  });

  await writeOnboardingPayload({
    onboardingStep: "first-task",
  });

  return { ok: true, goalId };
}

// ── 5. commit-first-task ─────────────────────────────────────

/** Walk the reconstructed plan and pick the first must-do task from the
 *  earliest (unlocked) day. Returns null if no plan tasks exist. */
function pickFirstTask(plan: GoalPlan | null): GoalPlanTask | null {
  if (!plan || !Array.isArray(plan.years)) return null;
  for (const yr of plan.years) {
    for (const mo of yr.months) {
      for (const wk of mo.weeks) {
        for (const dy of wk.days) {
          // Prefer must-do; fall back to should-do, then any.
          const mustDo = dy.tasks.find((t) => t.priority === "must-do" && !t.completed);
          if (mustDo) return mustDo;
          const shouldDo = dy.tasks.find((t) => t.priority === "should-do" && !t.completed);
          if (shouldDo) return shouldDo;
          const any = dy.tasks.find((t) => !t.completed);
          if (any) return any;
        }
      }
    }
  }
  return null;
}

export async function cmdCommitFirstTask(
  body: Record<string, unknown>,
): Promise<unknown> {
  const payload = await readOnboardingPayload();
  const goalId = (body.goalId as string | undefined) ?? payload.onboardingGoalId;
  if (!goalId) {
    throw new Error("command:commit-first-task requires args.goalId (or prior confirm-onboarding-goal)");
  }

  const existing = await repos.goals.get(goalId);
  if (!existing) throw new Error(`goal ${goalId} not found`);

  // Reconstruct plan from goal_plan_nodes (authoritative) or fall back to
  // the inline goal.plan.
  const nodes = await repos.goalPlan.listForGoal(goalId);
  const reconstructed =
    nodes.length > 0 ? repos.goalPlan.reconstructPlan(nodes) : null;
  const plan: GoalPlan | null = reconstructed ?? existing.plan ?? null;

  const today = new Date().toISOString().split("T")[0];

  // Either use caller-supplied task or auto-pick from the plan.
  let taskTitle = body.taskTitle as string | undefined;
  let planNodeId: string | null = null;
  let taskCategory: GoalPlanTask["category"] = "planning";
  let taskDuration = 30;
  let taskPriority: GoalPlanTask["priority"] = "must-do";
  if (!taskTitle) {
    const picked = pickFirstTask(plan);
    if (!picked) {
      throw new Error(`goal ${goalId} has no plan tasks to commit as the first task`);
    }
    taskTitle = picked.title;
    planNodeId = picked.id;
    taskCategory = picked.category;
    taskDuration = picked.durationMinutes;
    taskPriority = picked.priority;
  }

  const existingForDate = await repos.dailyTasks.listForDate(today);
  const taskId = `onb-${crypto.randomUUID()}`;
  await repos.dailyTasks.insert({
    id: taskId,
    date: today,
    title: taskTitle,
    goalId,
    planNodeId,
    completed: false,
    orderIndex: existingForDate.length,
    source: "big_goal",
    payload: {
      description: "First task from onboarding — 30 minutes, nothing scary.",
      durationMinutes: taskDuration,
      cognitiveWeight: taskPriority === "must-do" ? 5 : 3,
      priority: taskPriority,
      category: taskCategory,
      source: "onboarding-first-task",
    },
  });
  await repos.dailyLogs.ensureExists(today);

  // Mark onboarding complete on the user row and stash the task id on payload
  // so the UI can deep-link to "your first task".
  await repos.users.updatePayload({
    onboardingFirstTaskId: taskId,
    onboardingStep: "complete",
  });

  // Use the narrow completeOnboarding helper to flip the column.
  const user = await repos.users.get();
  if (user) {
    await repos.users.completeOnboarding(user.name ?? "", user.goalRaw ?? "");
  }

  return { ok: true, goalId, taskId };
}
