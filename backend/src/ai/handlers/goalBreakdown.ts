/* NorthStar — Goal Breakdown handler */

import Anthropic from "@anthropic-ai/sdk";
import { getScheduleContext, summarizeScheduleForAI } from "../../calendar";
import { getModelForTask } from "../../model-config";
import { GOAL_BREAKDOWN_SYSTEM } from "../prompts";
import { personalizeSystem } from "../personalize";

export async function handleGoalBreakdown(
  client: Anthropic,
  payload: Record<string, unknown>,
  memoryContext: string,
): Promise<unknown> {
  const goal = payload.goal;
  const targetDate = (payload.targetDate as string) || "";
  const dailyHours = (payload.dailyHours as number) || 2;
  const inAppEvents = (payload.inAppEvents || []) as unknown[];
  const deviceIntegrations = payload.deviceIntegrations as
    | { calendar?: { enabled: boolean; selectedCalendars: string[] } }
    | undefined;

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

  const response = await client.messages.create({
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
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  const parsed = JSON.parse(cleaned);

  return {
    id: `breakdown-${Date.now()}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
    ...parsed,
  };
}
