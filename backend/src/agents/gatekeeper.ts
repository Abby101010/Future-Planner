/* ──────────────────────────────────────────────────────────
   Starward — Gatekeeper Sub-Agent

   Two modes:
   a) Full mode (daily-tasks): Haiku AI call for filtering +
      priority scoring, then budget checks in code.
      Includes rotation-aware scoring (recency, velocity,
      deadline pressure) so all goals get fair attention.
   b) Budget-check mode: no AI call, just code-level budget
      enforcement for mutation-time checks.
   ────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import { getClient } from "../ai/client";
import { emitAgentProgress } from "../ws";
import { getCurrentUserId } from "../middleware/requestContext";
import {
  getModelForTask,
  COGNITIVE_BUDGET,
  enforceBudgetSnake,
} from "@starward/core";
import type {
  TaskStateInput,
  GatekeeperResult,
  TriagedTask,
  BudgetCheck,
  GoalRotation,
  CandidateTask,
} from "@starward/core";
import { GATEKEEPER_SYSTEM } from "./prompts/gatekeeper";

// ── Helpers ────────────────────────────────────────────────

function collectCandidates(input: TaskStateInput): CandidateTask[] {
  return input.goals.flatMap((g) => g.planTasksToday);
}

function computeBudgetCheck(tasks: TriagedTask[]): BudgetCheck {
  const totalWeight = tasks.reduce((sum, t) => sum + t.cognitiveWeight, 0);
  const overBudget = totalWeight > COGNITIVE_BUDGET.MAX_DAILY_WEIGHT ||
    tasks.length > COGNITIVE_BUDGET.MAX_DAILY_TASKS;

  const snakeTasks = tasks.map((t) => ({
    cognitive_weight: t.cognitiveWeight,
    duration_minutes: t.durationMinutes,
    priority: t.signal === "high" ? "must-do" : t.signal === "medium" ? "should-do" : "bonus",
    _id: t.id,
  }));

  const trimmed = enforceBudgetSnake(snakeTasks);
  const keptIds = new Set(trimmed.map((t) => (t as typeof snakeTasks[number])._id));
  const droppedIds = tasks.filter((t) => !keptIds.has(t.id)).map((t) => t.id);

  return {
    totalWeight: trimmed.reduce(
      (s, t) => s + (t.cognitive_weight ?? COGNITIVE_BUDGET.DEFAULT_WEIGHT),
      0,
    ),
    maxWeight: COGNITIVE_BUDGET.MAX_DAILY_WEIGHT,
    overBudget,
    tasksDropped: droppedIds,
  };
}

function computeGoalRotation(input: TaskStateInput): GoalRotation {
  const STALE_THRESHOLD_DAYS = 3;
  const rotationScores: Record<string, number> = {};
  const staleGoals: string[] = [];

  for (const g of input.goals) {
    if (g.goalType !== "big") continue;
    // A-5: paused goals are intentionally parked by the user. Skip them so
    // the staleness boost doesn't spam their tasks back into the daily plan.
    if (g.status === "paused") continue;
    const recency = Math.min(g.daysSinceLastWorked, 14);
    const recencyScore = recency / 14;
    rotationScores[g.id] = recencyScore;
    if (g.daysSinceLastWorked >= STALE_THRESHOLD_DAYS) {
      staleGoals.push(g.id);
    }
  }

  return {
    goalCount: input.goals.filter((g) => g.goalType === "big").length,
    rotationScores,
    staleGoals,
  };
}

function parseAiResponse(text: string): { filteredTasks: TriagedTask[]; priorityScores: Record<string, number> } {
  try {
    const cleaned = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    return {
      filteredTasks: Array.isArray(parsed.filteredTasks) ? parsed.filteredTasks : [],
      priorityScores: parsed.priorityScores && typeof parsed.priorityScores === "object"
        ? parsed.priorityScores
        : {},
    };
  } catch {
    console.error("[gatekeeper] Failed to parse AI response, returning empty result");
    return { filteredTasks: [], priorityScores: {} };
  }
}

// ── Full Gatekeeper (AI + budget checks) ──────────────────

export async function runGatekeeper(input: TaskStateInput): Promise<GatekeeperResult> {
  const userId = getCurrentUserId();
  emitAgentProgress(userId, {
    agentId: "gatekeeper",
    phase: "running",
    message: "Filtering tasks and scoring priorities",
  });

  const candidates = collectCandidates(input);
  const goalRotation = computeGoalRotation(input);

  if (candidates.length === 0) {
    emitAgentProgress(userId, { agentId: "gatekeeper", phase: "done" });
    return {
      filteredTasks: [],
      priorityScores: {},
      budgetCheck: {
        totalWeight: 0,
        maxWeight: COGNITIVE_BUDGET.MAX_DAILY_WEIGHT,
        overBudget: false,
        tasksDropped: [],
      },
      goalRotation,
    };
  }

  const userMessage = `Today is ${input.date}.

CANDIDATE TASKS:
${JSON.stringify(candidates, null, 2)}

GOALS CONTEXT:
${input.goals.map((g) => `- "${g.title}" (${g.goalType}, status: ${g.status}, last worked: ${g.lastTouchedDate ?? "never"}, days since: ${g.daysSinceLastWorked}, target: ${g.targetDate ?? "none"})`).join("\n")}

STALE GOALS (not touched in 3+ days — boost priority):
${goalRotation.staleGoals.length > 0 ? goalRotation.staleGoals.map((id) => `- ${input.goals.find((g) => g.id === id)?.title ?? id}`).join("\n") : "None"}

USER CONTEXT:
- Recent completion rate: ${input.recentCompletionRate === -1 ? "no data (new user)" : `${input.recentCompletionRate}%`}
- Capacity budget: ${input.capacityBudget}
${input.memoryContext ? `- Memory: ${input.memoryContext}` : ""}

Filter these candidates and score their priority. Return JSON only.`;

  const client = getClient();
  let filteredTasks: TriagedTask[] = [];
  let priorityScores: Record<string, number> = {};

  if (client) {
    try {
      const response = await client.messages.create({
        model: getModelForTask("gatekeeper"),
        max_tokens: 2048,
        system: GATEKEEPER_SYSTEM,
        messages: [{ role: "user", content: userMessage }],
      });

      const text = response.content
        .filter((b: Anthropic.ContentBlock): b is Anthropic.TextBlock => b.type === "text")
        .map((b: Anthropic.TextBlock) => b.text)
        .join("");

      const aiResult = parseAiResponse(text);
      filteredTasks = aiResult.filteredTasks;
      priorityScores = aiResult.priorityScores;
    } catch (err) {
      console.error("[gatekeeper] AI call failed, falling back to pass-through:", err);
      const { recordAgentFallback } = await import("../services/signalRecorder");
      recordAgentFallback("gatekeeper", err instanceof Error ? err.message : String(err)).catch(() => {});
      filteredTasks = candidates.map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        durationMinutes: c.durationMinutes,
        goalId: c.goalId,
        goalTitle: c.goalTitle,
        planNodeId: c.planNodeId,
        priority: 5,
        signal: "medium" as const,
        cognitiveWeight: COGNITIVE_BUDGET.DEFAULT_WEIGHT,
        category: c.category,
      }));
      priorityScores = Object.fromEntries(candidates.map((c) => [c.id, 5]));
    }
  } else {
    filteredTasks = candidates.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      durationMinutes: c.durationMinutes,
      goalId: c.goalId,
      goalTitle: c.goalTitle,
      planNodeId: c.planNodeId,
      priority: 5,
      signal: "medium" as const,
      cognitiveWeight: COGNITIVE_BUDGET.DEFAULT_WEIGHT,
      category: c.category,
    }));
    priorityScores = Object.fromEntries(candidates.map((c) => [c.id, 5]));
  }

  const budgetCheck = computeBudgetCheck(filteredTasks);

  if (budgetCheck.tasksDropped.length > 0) {
    const droppedSet = new Set(budgetCheck.tasksDropped);
    filteredTasks = filteredTasks.filter((t) => !droppedSet.has(t.id));
  }

  emitAgentProgress(userId, { agentId: "gatekeeper", phase: "done" });

  return {
    filteredTasks,
    priorityScores,
    budgetCheck,
    goalRotation,
  };
}

// ── Lightweight budget-check mode (no AI call) ────────────

export function runBudgetCheck(
  currentTasks: Array<{ cognitiveWeight?: number; durationMinutes?: number }>,
  newTaskWeight: number,
): BudgetCheck {
  const currentWeight = currentTasks.reduce(
    (sum, t) => sum + (t.cognitiveWeight ?? COGNITIVE_BUDGET.DEFAULT_WEIGHT),
    0,
  );
  const projectedWeight = currentWeight + newTaskWeight;
  const overBudget =
    projectedWeight > COGNITIVE_BUDGET.MAX_DAILY_WEIGHT ||
    currentTasks.length + 1 > COGNITIVE_BUDGET.MAX_DAILY_TASKS;

  return {
    totalWeight: projectedWeight,
    maxWeight: COGNITIVE_BUDGET.MAX_DAILY_WEIGHT,
    overBudget,
    tasksDropped: [],
  };
}
