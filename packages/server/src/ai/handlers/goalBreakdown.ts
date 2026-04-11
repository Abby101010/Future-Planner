/* NorthStar — Goal Breakdown handler */

import Anthropic from "@anthropic-ai/sdk";
import { getScheduleContext, summarizeScheduleForAI } from "../../calendar";
import { getModelForTask } from "@northstar/core";
import { GOAL_BREAKDOWN_SYSTEM } from "@northstar/core";
import { personalizeSystem } from "@northstar/core";
import type { GoalBreakdownPayload } from "@northstar/core";
import { runStreamingHandler } from "../streaming";
import { emitAgentProgress } from "../../ws";
import { getCurrentUserId } from "../../middleware/requestContext";

export async function handleGoalBreakdown(
  client: Anthropic,
  payload: GoalBreakdownPayload,
  memoryContext: string,
): Promise<unknown> {
  const { goal, deviceIntegrations } = payload;
  const targetDate = payload.targetDate ?? "";
  const dailyHours = payload.dailyHours ?? 2;
  const inAppEvents = payload.inAppEvents ?? [];

  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 90);

  let scheduleInfo =
    "No calendar events found. User has not added any events to their calendar yet.";
  try {
    const schedule = await getScheduleContext(
      today.toISOString().split("T")[0],
      endDate.toISOString().split("T")[0],
      inAppEvents as any,
      deviceIntegrations,
    );
    if (schedule.days.some((d) => d.events.length > 0)) {
      scheduleInfo = summarizeScheduleForAI(schedule);
    }
  } catch {
    console.warn("Calendar schedule build failed");
  }

  const handlerKind = "goalBreakdown";
  const userId = getCurrentUserId();
  emitAgentProgress(userId, {
    agentId: handlerKind,
    phase: "running",
    message: "Breaking down goal",
  });

  const parsed = await runStreamingHandler<Record<string, unknown>>({
    handlerKind,
    client,
    createRequest: () => ({
      model: getModelForTask("goal-breakdown"),
      max_tokens: 16384,
      system: personalizeSystem(GOAL_BREAKDOWN_SYSTEM, memoryContext),
      messages: [
        {
          role: "user",
          content: `TODAY'S DATE: ${today.toISOString().split("T")[0]}

MY GOAL:
${JSON.stringify(goal, null, 2)}

TARGET COMPLETION: ${targetDate || "flexible - suggest a realistic date"}
DAILY TIME BUDGET: ${dailyHours} hours/day

${scheduleInfo}

Please break down my goal into a complete hierarchical plan (years -> months -> weeks -> days).
Respect my calendar - no tasks on vacation days, lighter tasks on busy days.`,
        },
      ],
    }),
    parseResult: (finalText) => {
      const cleaned = finalText
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      return JSON.parse(cleaned);
    },
  });

  emitAgentProgress(userId, { agentId: handlerKind, phase: "done" });

  return {
    id: `breakdown-${Date.now()}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
    ...parsed,
  };
}
