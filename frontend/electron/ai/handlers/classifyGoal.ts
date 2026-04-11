/* NorthStar — Classify Goal handler (big / everyday / repeating) */

import Anthropic from "@anthropic-ai/sdk";
import { getModelForTask } from "../../model-config";
import { CLASSIFY_GOAL_SYSTEM } from "../prompts";
import { personalizeSystem } from "../personalize";

export async function handleClassifyGoal(
  client: Anthropic,
  payload: Record<string, unknown>,
  memoryContext: string,
): Promise<unknown> {
  const title = payload.title as string;
  const targetDate = payload.targetDate as string;
  const importance = payload.importance as string;
  const isHabit = payload.isHabit as boolean;
  const description = (payload.description as string) || "";

  const response = await client.messages.create({
    model: getModelForTask("classify-goal"),
    max_tokens: 1024,
    system: personalizeSystem(CLASSIFY_GOAL_SYSTEM, memoryContext),
    messages: [
      {
        role: "user",
        content: `Goal: "${title}"
Type: ${isHabit ? "Ongoing habit (no due date)" : "Goal with target date"}
Target date: ${isHabit ? "N/A (habit)" : targetDate || "flexible"}
Importance: ${importance}
${description ? `User's extra context/description: "${description}"` : "No extra description provided."}
Today's date: ${new Date().toISOString().split("T")[0]}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    console.error(
      "[ai-handler] classify-goal: failed to parse AI response:",
      cleaned.slice(0, 500),
    );
    throw new Error(
      "AI returned invalid JSON for goal classification. Please try again.",
    );
  }
}
