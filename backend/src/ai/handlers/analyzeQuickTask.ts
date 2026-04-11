/* NorthStar — Analyze Quick Task handler */

import Anthropic from "@anthropic-ai/sdk";
import { getScheduleContext } from "../../calendar";
import { getModelForTask } from "../../../../shared/model-config";
import { ANALYZE_QUICK_TASK_SYSTEM } from "../../../../shared/ai/prompts";
import { personalizeSystem } from "../../../../shared/ai/personalize";
import type { AnalyzeQuickTaskPayload } from "../../../../shared/ai/payloads";

export async function handleAnalyzeQuickTask(
  client: Anthropic,
  payload: AnalyzeQuickTaskPayload,
  memoryContext: string,
): Promise<unknown> {
  const { userInput } = payload;
  const existingTasks = (payload.existingTasks ?? []) as Array<{
    title: string;
    cognitiveWeight?: number;
    durationMinutes?: number;
    priority?: string;
  }>;
  const goals = (payload.goals ?? []) as Array<{
    title: string;
    scope: string;
  }>;
  const todayCalendarEvents = (payload.todayCalendarEvents ?? []) as Array<{
    title: string;
    startDate: string;
    endDate: string;
    durationMinutes: number;
    category: string;
  }>;

  const today = new Date().toISOString().split("T")[0];

  const existingTasksSummary =
    existingTasks.length > 0
      ? existingTasks
          .map(
            (t, i) =>
              `  ${i + 1}. "${t.title}" (weight: ${t.cognitiveWeight || 3}, ${t.durationMinutes || 30}min, ${t.priority || "should-do"})`,
          )
          .join("\n")
      : "  No tasks yet today.";

  const totalWeight = existingTasks.reduce(
    (sum, t) => sum + (t.cognitiveWeight || 3),
    0,
  );
  const totalMinutes = existingTasks.reduce(
    (sum, t) => sum + (t.durationMinutes || 30),
    0,
  );
  const remainingBudget = 12 - totalWeight;

  const goalsSummary =
    goals.length > 0
      ? goals.map((g) => `  - ${g.title} (${g.scope})`).join("\n")
      : "  No goals set.";

  const calendarSummary =
    todayCalendarEvents.length > 0
      ? todayCalendarEvents
          .map(
            (e) =>
              `  - "${e.title}" (${e.startDate} – ${e.endDate}, ${e.durationMinutes}min, ${e.category})`,
          )
          .join("\n")
      : "  No calendar events today.";

  let todayFreeMinutes = 120;
  try {
    const schedule = await getScheduleContext(today, today, [], undefined);
    if (schedule.days.length > 0) {
      todayFreeMinutes = Math.min(schedule.days[0].freeMinutes, 240);
    }
  } catch {
    /* no calendar data */
  }

  const remainingFreeMinutes = Math.max(0, todayFreeMinutes - totalMinutes);

  const schedulingContextFormatted =
    payload._schedulingContextFormatted ?? "";
  const schedulingBlock = schedulingContextFormatted
    ? `\n${schedulingContextFormatted}\n`
    : "";

  const environmentFormatted =
    payload._environmentContextFormatted ?? "";
  const environmentBlock = environmentFormatted
    ? `\n${environmentFormatted}\n`
    : "";

  const response = await client.messages.create({
    model: getModelForTask("analyze-quick-task"),
    max_tokens: 512,
    system: personalizeSystem(ANALYZE_QUICK_TASK_SYSTEM, memoryContext),
    messages: [
      {
        role: "user",
        content: `TODAY: ${today}
${environmentBlock}${schedulingBlock}
USER INPUT: "${userInput}"

EXISTING TASKS TODAY:
${existingTasksSummary}
  Total cognitive weight used: ${totalWeight}/12
  Remaining cognitive budget: ${remainingBudget} points
  Total task time so far: ${totalMinutes}min
  Remaining free time: ~${remainingFreeMinutes}min

CALENDAR EVENTS TODAY:
${calendarSummary}

USER'S GOALS:
${goalsSummary}

IMPORTANT: If adding this task would push total weight above 12 or total time beyond
the remaining free time, suggest scheduling it for TOMORROW instead of today.
If it's genuinely urgent (deadline today), note the overload explicitly.

Analyze this task and suggest how to schedule it.`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  return JSON.parse(cleaned);
}
