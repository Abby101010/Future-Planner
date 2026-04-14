/* NorthStar — Generate Goal Plan handler (initial plan) */

import Anthropic from "@anthropic-ai/sdk";
import { getModelForTask } from "../../model-config.js";
import { GENERATE_GOAL_PLAN_SYSTEM } from "../prompts/index.js";
import { personalizeSystem } from "../personalize.js";
import type { GenerateGoalPlanPayload } from "../payloads.js";

export async function handleGenerateGoalPlan(
  client: Anthropic,
  payload: GenerateGoalPlanPayload,
  memoryContext: string,
): Promise<unknown> {
  const { goalTitle, targetDate, importance, isHabit } = payload;
  const description = payload.description ?? "";

  // Research context injected by the coordinator
  const researchSummary = payload._researchSummary ?? "";
  const researchFindings = payload._researchFindings ?? [];

  const today = new Date().toISOString().split("T")[0];
  const startDate = (payload as unknown as Record<string, unknown>).startDate as string | undefined;
  const goalContext = [
    `- Goal: "${goalTitle}"`,
    `- Type: ${isHabit ? "Ongoing habit (no due date)" : "Goal with target date"}`,
    `- Start date: ${startDate || today}`,
    `- Target date: ${isHabit ? "N/A (habit)" : targetDate || "flexible"}`,
    `- Importance: ${importance}`,
    description ? `- User's description/context: "${description}"` : null,
    `- Today: ${today}`,
  ]
    .filter(Boolean)
    .join("\n");

  let researchBlock = "";
  if (researchSummary) {
    researchBlock = `\n\nRESEARCH DATA (use this to make the plan realistic):
${researchSummary}

KEY FINDINGS:
${researchFindings.map((f, i) => `${i + 1}. ${f}`).join("\n")}

IMPORTANT: Use the research data above to set REALISTIC timelines and milestones.
Do NOT ignore this data. If research says something takes 6 months, don't plan for 2 weeks.`;
  }

  const response = await client.messages.create({
    model: getModelForTask("generate-goal-plan"),
    max_tokens: 8192,
    system: personalizeSystem(
      `${GENERATE_GOAL_PLAN_SYSTEM}\n\nGOAL CONTEXT:\n${goalContext}${researchBlock}`,
      memoryContext,
    ),
    messages: [
      {
        role: "user",
        content: `Please create a comprehensive plan for my goal: "${goalTitle}"
Type: ${isHabit ? "Ongoing habit (no due date)" : "Goal with target date"}
Target date: ${isHabit ? "N/A (habit)" : targetDate || "flexible"}
Importance level: ${importance}${description ? `\nAdditional context: ${description}` : ""}${researchSummary ? `\n\nThe research agent found the following about this goal domain:\n${researchSummary}` : ""}`,
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
