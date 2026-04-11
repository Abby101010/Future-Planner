/* ──────────────────────────────────────────────────────────
   NorthStar server — AI request router (simplified)

   Differences from electron/ai/router.ts:
   1. NO multi-agent coordinator. Complex requests that previously
      went through `coordinateRequest` (generate-goal-plan,
      goal-plan-edit, daily-tasks, goal-breakdown, reallocate) now
      go directly to their handlers without the research /
      scheduling / capacity enrichment pass.
   2. NO memory context. The memory/reflection system stays in the
      Electron shell for phase 1 — buildMemoryContext always returns
      an empty string here, which handlers treat as "fresh install".

   This is a deliberate scope cut: bringing the coordinator and
   memory pipeline to the cloud is phase 1b work. Phase 1's MVP
   just needs every AI channel to respond with usable output.

   Handler quality trade-off:
   - Simple requests (home-chat, classify-goal, pace-check,
     analyze-quick-task, analyze-monthly-context, onboarding,
     goal-plan-chat, goal-plan-edit, recovery) work exactly as
     they did in Electron.
   - Complex requests (generate-goal-plan, goal-breakdown,
     daily-tasks, reallocate) produce output but without the
     multi-agent context enrichment. Still useful, just less
     context-aware. Phase 1b restores parity.
   ────────────────────────────────────────────────────────── */

import type Anthropic from "@anthropic-ai/sdk";
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

export async function handleAIRequest(
  type: RequestType,
  payload: Record<string, unknown>,
  loadData: () => Record<string, unknown>,
  memoryContext = "",
): Promise<unknown> {
  const client = getClient(loadData);
  if (!client) {
    throw new Error(
      "ANTHROPIC_API_KEY not configured on server. Set it in Fly secrets.",
    );
  }
  return handleAIRequestDirect(type, payload, memoryContext, client);
}

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
