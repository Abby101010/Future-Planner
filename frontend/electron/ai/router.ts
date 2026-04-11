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
import { stripLoneSurrogates, sanitizeForJSON } from "../../../shared/ai/sanitize";
import { getClient } from "./client";

// Platform-dependent handlers stay local — they import from ../../calendar,
// ../../memory, ../../database, ../../reflection (Electron-only).
import { handleGoalBreakdown } from "./handlers/goalBreakdown";
import { handleReallocate } from "./handlers/reallocate";
import { handleDailyTasks } from "./handlers/dailyTasks";
import { handleRecovery } from "./handlers/recovery";
import { handlePaceCheck } from "./handlers/paceCheck";
import { handleAnalyzeQuickTask } from "./handlers/analyzeQuickTask";

// Agnostic handlers — single source of truth in shared/.
import { handleOnboarding } from "../../../shared/ai/handlers/onboarding";
import { handleClassifyGoal } from "../../../shared/ai/handlers/classifyGoal";
import { handleGoalPlanChat } from "../../../shared/ai/handlers/goalPlanChat";
import { handleGoalPlanEdit } from "../../../shared/ai/handlers/goalPlanEdit";
import { handleGenerateGoalPlan } from "../../../shared/ai/handlers/generateGoalPlan";
import { handleAnalyzeMonthlyContext } from "../../../shared/ai/handlers/analyzeMonthlyContext";
import { handleHomeChat } from "../../../shared/ai/handlers/homeChat";
import type { AIPayloadMap } from "../../../shared/ai/payloads";

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

  // Trust-but-cast at the boundary: payloads cross IPC as JSON so we
  // cannot validate them at the type level here. Each case narrows the
  // payload to its handler's specific shape; handlers rely on those
  // types rather than re-casting every field.
  const p = payload as unknown;
  switch (type) {
    case "onboarding":
      return handleOnboarding(client, p as AIPayloadMap["onboarding"], memoryContext);
    case "goal-breakdown":
      return handleGoalBreakdown(client, p as AIPayloadMap["goal-breakdown"], memoryContext);
    case "reallocate":
      return handleReallocate(client, p as AIPayloadMap["reallocate"], memoryContext);
    case "daily-tasks":
      return handleDailyTasks(client, p as AIPayloadMap["daily-tasks"], memoryContext);
    case "recovery":
      return handleRecovery(client, p as AIPayloadMap["recovery"], memoryContext);
    case "pace-check":
      return handlePaceCheck(client, p as AIPayloadMap["pace-check"], memoryContext);
    case "classify-goal":
      return handleClassifyGoal(client, p as AIPayloadMap["classify-goal"], memoryContext);
    case "goal-plan-chat":
      return handleGoalPlanChat(client, p as AIPayloadMap["goal-plan-chat"], memoryContext);
    case "goal-plan-edit":
      return handleGoalPlanEdit(client, p as AIPayloadMap["goal-plan-edit"], memoryContext);
    case "generate-goal-plan":
      return handleGenerateGoalPlan(client, p as AIPayloadMap["generate-goal-plan"], memoryContext);
    case "analyze-quick-task":
      return handleAnalyzeQuickTask(client, p as AIPayloadMap["analyze-quick-task"], memoryContext);
    case "analyze-monthly-context":
      return handleAnalyzeMonthlyContext(client, p as AIPayloadMap["analyze-monthly-context"], memoryContext);
    case "home-chat":
      return handleHomeChat(client, p as AIPayloadMap["home-chat"], memoryContext);
  }
}
