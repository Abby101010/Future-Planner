/* NorthStar — Classify Goal handler (big / everyday / repeating) */

import Anthropic from "@anthropic-ai/sdk";
import { getModelForTask } from "../../model-config.js";
import { CLASSIFY_GOAL_SYSTEM } from "../prompts.js";
import { personalizeSystem } from "../personalize.js";
import type { ClassifyGoalPayload } from "../payloads.js";

export async function handleClassifyGoal(
  client: Anthropic,
  payload: ClassifyGoalPayload,
  memoryContext: string,
): Promise<unknown> {
  const { title, targetDate, importance, isHabit } = payload;
  const description = payload.description ?? "";

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
  // Haiku occasionally appends trailing prose after the JSON. Extract the
  // first balanced {...} block instead of parsing the whole string.
  const start = cleaned.indexOf("{");
  let parsed: unknown = null;
  if (start >= 0) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const slice = cleaned.slice(start, i + 1);
          try { parsed = JSON.parse(slice); } catch { /* fall through */ }
          break;
        }
      }
    }
  }
  if (parsed !== null) return parsed;
  console.error(
    "[ai-handler] classify-goal: failed to parse AI response:",
    cleaned.slice(0, 500),
  );
  throw new Error(
    "AI returned invalid JSON for goal classification. Please try again.",
  );
}
