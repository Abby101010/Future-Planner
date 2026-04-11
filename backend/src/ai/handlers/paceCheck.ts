/* NorthStar — Pace Check handler */

import Anthropic from "@anthropic-ai/sdk";
import { runReflection } from "../../reflection";
import { getCurrentUserId } from "../../middleware/requestContext";
import { getModelForTask } from "../../model-config";
import { PACE_CHECK_SYSTEM } from "../prompts";
import { personalizeSystem } from "../personalize";

export async function handlePaceCheck(
  client: Anthropic,
  payload: Record<string, unknown>,
  memoryContext: string,
): Promise<unknown> {
  const breakdown = payload.breakdown || payload.roadmap;
  const logs = payload.logs;

  const response = await client.messages.create({
    model: getModelForTask("pace-check"),
    max_tokens: 2048,
    system: personalizeSystem(PACE_CHECK_SYSTEM, memoryContext),
    messages: [
      {
        role: "user",
        content: `GOAL BREAKDOWN:
${JSON.stringify(breakdown, null, 2)}

DAILY LOGS:
${JSON.stringify(logs, null, 2)}

Please do a pace check.`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  const result = JSON.parse(cleaned);

  // Pace check is a natural reflection trigger — run in background
  runReflection(client, getCurrentUserId(), "weekly_pace_check").catch((err) =>
    console.warn("Background reflection failed:", err),
  );

  return result;
}
