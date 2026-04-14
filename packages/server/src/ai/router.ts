/* ──────────────────────────────────────────────────────────
   NorthStar server — AI request router

   Routes AI requests to handlers. Complex requests (daily-tasks,
   generate-goal-plan, reallocate, adaptive-reschedule) go through
   the Coordinator first for multi-agent enrichment, then the
   enriched context is injected into the handler's payload via
   EnrichedPayload fields.

   Simple requests (home-chat, classify-goal, etc.) go directly
   to handlers without coordinator overhead.
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
import { loadProjectContext } from "../coordinators/bigGoal/projectAgentContext";

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
  handleUnifiedChat,
} from "@northstar/core/handlers";
import type { AIPayloadMap, TaskState, ScheduleBlock } from "@northstar/core";

function buildScheduleBlockText(tierEnforcement: {
  calendarBlocks: ScheduleBlock[];
  goalBlocks: ScheduleBlock[];
  taskSlots: ScheduleBlock[];
}): string {
  const lines: string[] = ["SCHEDULE STRUCTURE (pre-computed by scheduling agent):"];

  lines.push("Tier 1 — Calendar (FIXED, do not move):");
  if (tierEnforcement.calendarBlocks.length === 0) {
    lines.push("  (none)");
  } else {
    for (const b of tierEnforcement.calendarBlocks) {
      lines.push(`  [${b.startTime}-${b.endTime}] ${b.label} (${b.durationMinutes}min)`);
    }
  }

  lines.push("Tier 2 — Goal Deep Work (PROTECTED):");
  if (tierEnforcement.goalBlocks.length === 0) {
    lines.push("  (none)");
  } else {
    for (const b of tierEnforcement.goalBlocks) {
      lines.push(`  [${b.startTime}-${b.endTime}] ${b.label} (${b.durationMinutes}min)`);
    }
  }

  lines.push("Tier 3 — Available for daily tasks:");
  if (tierEnforcement.taskSlots.length === 0) {
    lines.push("  (none)");
  } else {
    let totalAvailable = 0;
    for (const b of tierEnforcement.taskSlots) {
      lines.push(`  [${b.startTime}-${b.endTime}] ${b.durationMinutes}min`);
      totalAvailable += b.durationMinutes;
    }
    lines.push(`Total available: ${totalAvailable}min`);
  }

  return lines.join("\n");
}

function enrichPayload(
  payload: Record<string, unknown>,
  taskState: TaskState,
): Record<string, unknown> {
  const enriched = { ...payload };

  if (taskState.agents.gatekeeper) {
    enriched._researchContext = {
      filteredTasks: taskState.agents.gatekeeper.filteredTasks,
      priorityScores: taskState.agents.gatekeeper.priorityScores,
      budgetCheck: taskState.agents.gatekeeper.budgetCheck,
    };
  }

  if (taskState.agents.scheduler?.tierEnforcement) {
    enriched._schedulingContext = taskState.agents.scheduler;
    enriched._schedulingContextFormatted = buildScheduleBlockText(
      taskState.agents.scheduler.tierEnforcement,
    );
  }

  if (taskState.agents.timeEstimator) {
    enriched._environmentContext = {
      timeEstimates: taskState.agents.timeEstimator.estimates,
      totalMinutes: taskState.agents.timeEstimator.totalMinutes,
      exceedsDeepWorkCeiling: taskState.agents.timeEstimator.exceedsDeepWorkCeiling,
    };
    const est = taskState.agents.timeEstimator;
    const entries = Object.entries(est.estimates);
    if (entries.length > 0) {
      const lines = entries.map(([id, e]) =>
        `${id}: ${e.adjustedMinutes}min (original: ${e.originalMinutes}min, buffer: ${e.bufferMinutes}min, confidence: ${e.confidence})`,
      );
      enriched._environmentContextFormatted =
        `TIME ESTIMATES (planning-fallacy corrected):\n${lines.join("\n")}\nTotal: ${est.totalMinutes}min${est.exceedsDeepWorkCeiling ? " ⚠ EXCEEDS 3-HOUR DEEP WORK CEILING" : ""}`;
    }
  }

  return enriched;
}

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
  | "chat"
  | "news-briefing";

export async function handleAIRequest(
  type: RequestType,
  payload: Record<string, unknown>,
  memoryContext = "",
  coordinatorState?: TaskState,
): Promise<unknown> {
  const client = getClient();
  if (!client) {
    throw new Error(
      "ANTHROPIC_API_KEY not configured on server. Set it in Fly secrets.",
    );
  }
  const enrichedPayload = coordinatorState
    ? enrichPayload(payload, coordinatorState)
    : payload;
  return handleAIRequestDirect(type, enrichedPayload, memoryContext, client);
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
    case "goal-plan-chat": {
      const gpcPayload = p as AIPayloadMap["goal-plan-chat"];
      // Inject Project Agent Context (research, personalization, decisions)
      // from prior planning sessions so follow-up chats are context-aware.
      let enrichedMemory = memoryContext;
      if (gpcPayload.goalId) {
        try {
          const projCtx = await loadProjectContext(gpcPayload.goalId);
          if (projCtx) {
            const parts: string[] = [];
            if (projCtx.research) {
              parts.push(`RESEARCH CONTEXT: ${projCtx.research.summary}`);
              const f = projCtx.research.findings;
              if (f) {
                if (f.bestPractices?.length) parts.push(`Best practices: ${f.bestPractices.join("; ")}`);
                if (f.keyMilestones?.length) parts.push(`Key milestones: ${f.keyMilestones.join("; ")}`);
                if (f.commonPitfalls?.length) parts.push(`Watch out for: ${f.commonPitfalls.join("; ")}`);
              }
            }
            if (projCtx.personalization) {
              parts.push(`USER CAPACITY: avg ${projCtx.personalization.avgTasksPerDay} tasks/day, ${Math.round(projCtx.personalization.completionRate * 100)}% completion rate, overwhelm risk: ${projCtx.personalization.overwhelmRisk}, trend: ${projCtx.personalization.trend}`);
            }
            if (projCtx.decisions?.length) {
              parts.push(`PRIOR DECISIONS: ${projCtx.decisions.join("; ")}`);
            }
            if (parts.length > 0) {
              enrichedMemory = `${memoryContext}\n\nPROJECT AGENT CONTEXT (from prior planning session):\n${parts.join("\n")}`;
            }
          }
        } catch {
          // Project context loading is best-effort
        }
      }
      return handleGoalPlanChat(client, gpcPayload, enrichedMemory);
    }
    case "goal-plan-edit":
      return handleGoalPlanEdit(client, p as AIPayloadMap["goal-plan-edit"], memoryContext);
    case "generate-goal-plan":
      return handleGenerateGoalPlan(client, p as AIPayloadMap["generate-goal-plan"], memoryContext);
    case "analyze-quick-task":
      return handleAnalyzeQuickTask(client, p as AIPayloadMap["analyze-quick-task"], memoryContext);
    case "analyze-monthly-context":
      return handleAnalyzeMonthlyContext(client, p as AIPayloadMap["analyze-monthly-context"], memoryContext);
    case "home-chat": {
      // Stamp effective "today" (midnight boundary + TZ) so reminder/event
      // intents parsed from the chat reply land on the same calendar
      // day tasksView.ts filters against.
      const homePayload = p as AIPayloadMap["home-chat"];
      if (!homePayload.todayDate) homePayload.todayDate = getEffectiveDate();
      return handleHomeChat(client, homePayload, memoryContext);
    }
    case "chat": {
      const chatPayload = p as AIPayloadMap["chat"];
      if (!chatPayload.todayDate) chatPayload.todayDate = getEffectiveDate();
      return handleUnifiedChat(client, chatPayload, memoryContext);
    }
    case "news-briefing":
      return handleNewsBriefing(client, p as { goals: Array<{ id: string; title: string; description?: string; targetDate?: string; isHabit?: boolean }>; topic?: string }, memoryContext);
  }
}
