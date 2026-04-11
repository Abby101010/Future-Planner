/* ──────────────────────────────────────────────────────────
   NorthStar — AI request router

   Routes AI requests either through the multi-agent coordinator
   (for complex tasks that need research / scheduling context /
   capacity evaluation) or directly to a handler with lightweight
   memory context (for fast-path requests).
   ────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import { loadMemory, buildMemoryContext } from "../memory";
import { coordinateRequest } from "../agents/coordinator";
import type { CoordinatorTaskType, ProgressCallback } from "../agents/types";
import { stripLoneSurrogates, sanitizeForJSON } from "./sanitize";
import { getClient } from "./client";

import { handleOnboarding } from "./handlers/onboarding";
import { handleGoalBreakdown } from "./handlers/goalBreakdown";
import { handleReallocate } from "./handlers/reallocate";
import { handleDailyTasks } from "./handlers/dailyTasks";
import { handleRecovery } from "./handlers/recovery";
import { handlePaceCheck } from "./handlers/paceCheck";
import { handleClassifyGoal } from "./handlers/classifyGoal";
import { handleGoalPlanChat } from "./handlers/goalPlanChat";
import { handleGoalPlanEdit } from "./handlers/goalPlanEdit";
import { handleGenerateGoalPlan } from "./handlers/generateGoalPlan";
import { handleAnalyzeQuickTask } from "./handlers/analyzeQuickTask";
import { handleAnalyzeMonthlyContext } from "./handlers/analyzeMonthlyContext";
import { handleHomeChat } from "./handlers/homeChat";

export type RequestType =
  | "onboarding"
  | "goal-breakdown"
  | "reallocate"
  | "daily-tasks"
  | "recovery"
  | "pace-check"
  | "classify-goal"
  | "goal-plan-chat"
  | "goal-plan-edit"
  | "generate-goal-plan"
  | "analyze-quick-task"
  | "analyze-monthly-context"
  | "home-chat";

// Main handler — routes through coordinator for agent-enabled requests
export async function handleAIRequest(
  type: RequestType,
  payload: Record<string, unknown>,
  loadData: () => Record<string, unknown>,
  onProgress?: ProgressCallback,
): Promise<unknown> {
  const client = getClient(loadData);
  if (!client) {
    throw new Error(
      "No API key found. Please set your Claude API key in Settings.",
    );
  }

  // Route through coordinator ONLY for complex tasks that benefit from
  // multi-agent orchestration (research, scheduling context, capacity evaluation).
  // Simple tasks skip the coordinator for much faster response times.
  const coordinatorRouted: CoordinatorTaskType[] = [
    "generate-goal-plan", // needs research + scheduling context
    "goal-plan-edit", // needs plan context
    "daily-tasks", // needs scheduling + capacity + monthly context
    "goal-breakdown", // needs research
    "reallocate", // needs full context evaluation
  ];

  if (coordinatorRouted.includes(type as CoordinatorTaskType)) {
    const result = await coordinateRequest(
      client,
      type as CoordinatorTaskType,
      payload,
      loadData,
      onProgress,
    );

    if (!result.success) {
      const detail = result.error || "Unknown error";
      console.error(`[ai-handler] AI request "${type}" failed:`, detail);
      throw new Error(`AI request failed: ${detail}`);
    }

    return result.data;
  }

  // Fast path: direct handling with lightweight memory context
  const memory = loadMemory();
  const contextType: "planning" | "daily" | "recovery" | "general" =
    type === "recovery"
      ? "recovery"
      : type === "home-chat" || type === "analyze-quick-task"
        ? "daily"
        : "general";
  const now = new Date();
  const dayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const currentDay = dayNames[now.getDay()];
  const currentHour = now.getHours();
  const timeSlot =
    currentHour < 12 ? "morning" : currentHour < 17 ? "afternoon" : "evening";
  const contextTags = [currentDay, timeSlot];
  const memoryContext = buildMemoryContext(memory, contextType, contextTags);

  return handleAIRequestDirect(type, payload, memoryContext, client);
}

/**
 * Direct handler — executes a specific AI request without coordinator overhead.
 * Called by the coordinator after it has done research/preprocessing.
 * Also used as fallback for non-coordinator-routed requests.
 */
export async function handleAIRequestDirect(
  type: RequestType,
  payload: Record<string, unknown>,
  memoryContext: string,
  client: Anthropic,
): Promise<unknown> {
  // Strip lone surrogates from everything crossing the Anthropic API boundary.
  payload = sanitizeForJSON(payload);
  memoryContext = stripLoneSurrogates(memoryContext);

  switch (type) {
    case "onboarding":
      return handleOnboarding(client, payload, memoryContext);
    case "goal-breakdown":
      return handleGoalBreakdown(client, payload, memoryContext);
    case "reallocate":
      return handleReallocate(client, payload, memoryContext);
    case "daily-tasks":
      return handleDailyTasks(client, payload, memoryContext);
    case "recovery":
      return handleRecovery(client, payload, memoryContext);
    case "pace-check":
      return handlePaceCheck(client, payload, memoryContext);
    case "classify-goal":
      return handleClassifyGoal(client, payload, memoryContext);
    case "goal-plan-chat":
      return handleGoalPlanChat(client, payload, memoryContext);
    case "goal-plan-edit":
      return handleGoalPlanEdit(client, payload, memoryContext);
    case "generate-goal-plan":
      return handleGenerateGoalPlan(client, payload, memoryContext);
    case "analyze-quick-task":
      return handleAnalyzeQuickTask(client, payload, memoryContext);
    case "analyze-monthly-context":
      return handleAnalyzeMonthlyContext(client, payload, memoryContext);
    case "home-chat":
      return handleHomeChat(client, payload, memoryContext);
  }
}
