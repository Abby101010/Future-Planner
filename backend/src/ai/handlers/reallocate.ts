/* NorthStar — Reallocate handler */

import Anthropic from "@anthropic-ai/sdk";
import { getScheduleContext, summarizeScheduleForAI } from "../../calendar";
import { getModelForTask } from "@northstar/core";
import { REALLOCATE_SYSTEM } from "@northstar/core";
import { personalizeSystem } from "@northstar/core";
import type { ReallocatePayload } from "@northstar/core";
import { runStreamingHandler } from "../streaming";
import { emitAgentProgress } from "../../ws";
import { getCurrentUserId } from "../../middleware/requestContext";

export async function handleReallocate(
  client: Anthropic,
  payload: ReallocatePayload,
  memoryContext: string,
): Promise<unknown> {
  const currentBreakdown = payload.breakdown;
  const reason = payload.reason ?? "Schedule changed";
  const changes = payload.changes ?? {};

  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 90);

  let scheduleInfo = "No scheduled tasks available.";
  try {
    const schedule = await getScheduleContext(
      today.toISOString().split("T")[0],
      endDate.toISOString().split("T")[0],
    );
    scheduleInfo = summarizeScheduleForAI(schedule);
  } catch {
    console.warn("Schedule build failed");
  }

  const handlerKind = "reallocate";
  const userId = getCurrentUserId();
  emitAgentProgress(userId, {
    agentId: handlerKind,
    phase: "running",
    message: "Reallocating plan",
  });

  const parsed = await runStreamingHandler<Record<string, unknown>>({
    handlerKind,
    client,
    createRequest: () => ({
      model: getModelForTask("reallocate"),
      max_tokens: 16384,
      system: personalizeSystem(REALLOCATE_SYSTEM, memoryContext),
      messages: [
        {
          role: "user",
          content: `TODAY: ${today.toISOString().split("T")[0]}

REASON FOR REALLOCATION: ${reason}

SCHEDULE CHANGES:
${JSON.stringify(changes, null, 2)}

CURRENT GOAL BREAKDOWN:
${JSON.stringify(currentBreakdown, null, 2)}

UPDATED CALENDAR:
${scheduleInfo}

Please reallocate my plan around these changes.`,
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
    ...parsed,
    id:
      (currentBreakdown as Record<string, unknown>)?.id ||
      `breakdown-${Date.now()}`,
    updatedAt: new Date().toISOString(),
    version:
      (((currentBreakdown as Record<string, unknown>)?.version as number) ||
        0) + 1,
  };
}
