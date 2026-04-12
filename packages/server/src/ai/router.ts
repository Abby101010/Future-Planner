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
import { stripLoneSurrogates, sanitizeForJSON } from "@northstar/core";
import { getClient } from "./client";

// Platform-dependent handlers stay local — they import from
// ../../calendar, ../../memory, ../../database, ../../reflection.
import { handleGoalBreakdown } from "./handlers/goalBreakdown";
import { handleReallocate } from "./handlers/reallocate";
import { handleDailyTasks } from "./handlers/dailyTasks";
import { handleRecovery } from "./handlers/recovery";
import { handlePaceCheck } from "./handlers/paceCheck";
import { handleAnalyzeQuickTask } from "./handlers/analyzeQuickTask";
import { handleNewsBriefing } from "./handlers/newsBriefing";
import { getEffectiveDate } from "../dateUtils";

// Agnostic handlers — live in @northstar/core/handlers (server-only subpath).
// They pull in @anthropic-ai/sdk + node:crypto, so they must NOT come from
// the main @northstar/core barrel which the desktop renderer also consumes.
import {
  handleOnboarding,
  handleClassifyGoal,
  handleGoalPlanChat,
  handleGoalPlanEdit,
  handleGenerateGoalPlan,
  handleAnalyzeMonthlyContext,
  handleHomeChat,
} from "@northstar/core/handlers";
import type { AIPayloadMap } from "@northstar/core";

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
  | "home-chat"
  | "news-briefing";

export async function handleAIRequest(
  type: RequestType,
  payload: Record<string, unknown>,
  memoryContext = "",
): Promise<unknown> {
  const client = getClient();
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

  // Trust-but-cast at the boundary: payloads cross IPC/HTTP as JSON so we
  // cannot validate them at the type level here. Each case narrows the
  // payload to its handler's specific shape; handler code relies on these
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
    case "home-chat": {
      // Stamp effective "today" (6 AM boundary + TZ) so reminder/event
      // intents parsed from the chat reply land on the same calendar
      // day tasksView.ts filters against.
      const homePayload = p as AIPayloadMap["home-chat"];
      if (!homePayload.todayDate) homePayload.todayDate = getEffectiveDate();
      return handleHomeChat(client, homePayload, memoryContext);
    }
    case "news-briefing":
      return handleNewsBriefing(client, p as { goals: Array<{ id: string; title: string; description?: string; targetDate?: string; isHabit?: boolean }>; topic?: string }, memoryContext);
  }
}
