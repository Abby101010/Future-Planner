/* Starward — Goal Plan Edit handler (lightweight edit impact analysis) */

import Anthropic from "@anthropic-ai/sdk";
import { getModelForTask } from "../../model-config.js";
import { GOAL_PLAN_EDIT_SYSTEM } from "../prompts/index.js";
import { personalizeSystem } from "../personalize.js";
import type { GoalPlanEditPayload } from "../payloads.js";

export async function handleGoalPlanEdit(
  client: Anthropic,
  payload: GoalPlanEditPayload,
  memoryContext: string,
): Promise<unknown> {
  const { goalTitle, edit, planSummary } = payload;

  const editDescription = [
    `EDIT DETAILS:`,
    `- Level: ${edit.level}`,
    `- Target ID: ${edit.targetId}`,
    `- Field: ${edit.field}`,
    `- Old value: "${edit.oldValue}"`,
    `- New value: "${edit.newValue}"`,
    `- Path: ${JSON.stringify(edit.path)}`,
  ].join("\n");

  const response = await client.messages.create({
    model: getModelForTask("goal-plan-edit"),
    max_tokens: 512,
    system: personalizeSystem(
      `${GOAL_PLAN_EDIT_SYSTEM}\n\nGOAL: "${goalTitle}"\n\n${planSummary}`,
      memoryContext,
    ),
    messages: [{ role: "user", content: editDescription }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  return JSON.parse(cleaned);
}
