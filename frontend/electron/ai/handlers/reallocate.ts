/* NorthStar — Reallocate handler */

import Anthropic from "@anthropic-ai/sdk";
import { getScheduleContext, summarizeScheduleForAI } from "../../calendar";
import { getModelForTask } from "../../../../shared/model-config";
import { REALLOCATE_SYSTEM } from "../../../../shared/ai/prompts";
import { personalizeSystem } from "../../../../shared/ai/personalize";
import type { ReallocatePayload } from "../../../../shared/ai/payloads";

export async function handleReallocate(
  client: Anthropic,
  payload: ReallocatePayload,
  memoryContext: string,
): Promise<unknown> {
  const { deviceIntegrations } = payload;
  const currentBreakdown = payload.breakdown;
  const reason = payload.reason ?? "Schedule changed";
  const changes = payload.changes ?? {};
  const inAppEvents = payload.inAppEvents ?? [];

  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + 90);

  let scheduleInfo = "No calendar events available.";
  try {
    const schedule = await getScheduleContext(
      today.toISOString().split("T")[0],
      endDate.toISOString().split("T")[0],
      inAppEvents as any,
      deviceIntegrations,
    );
    scheduleInfo = summarizeScheduleForAI(schedule);
  } catch {
    console.warn("Calendar schedule build failed");
  }

  const response = await client.messages.create({
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
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  const parsed = JSON.parse(cleaned);

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
