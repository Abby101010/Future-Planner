/* NorthStar — Generate Goal Plan handler (initial plan) */

import Anthropic from "@anthropic-ai/sdk";
import { getModelForTask } from "../../model-config";
import { GENERATE_GOAL_PLAN_SYSTEM } from "../prompts";
import { personalizeSystem } from "../personalize";

export async function handleGenerateGoalPlan(
  client: Anthropic,
  payload: Record<string, unknown>,
  memoryContext: string,
): Promise<unknown> {
  const goalTitle = payload.goalTitle as string;
  const targetDate = payload.targetDate as string;
  const importance = payload.importance as string;
  const isHabit = payload.isHabit as boolean;
  const description = (payload.description as string) || "";

  // Research context injected by the coordinator
  const researchSummary = (payload._researchSummary as string) || "";
  const researchFindings = (payload._researchFindings as string[]) || [];

  const goalContext = [
    `- Goal: "${goalTitle}"`,
    `- Type: ${isHabit ? "Ongoing habit (no due date)" : "Goal with target date"}`,
    `- Target date: ${isHabit ? "N/A (habit)" : targetDate || "flexible"}`,
    `- Importance: ${importance}`,
    description ? `- User's description/context: "${description}"` : null,
    `- Today: ${new Date().toISOString().split("T")[0]}`,
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
