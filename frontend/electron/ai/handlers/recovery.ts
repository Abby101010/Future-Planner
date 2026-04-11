/* NorthStar — Recovery handler */

import Anthropic from "@anthropic-ai/sdk";
import { quickReflect, runReflection } from "../../reflection";
import { getModelForTask } from "../../../../shared/model-config";
import { RECOVERY_SYSTEM } from "../../../../shared/ai/prompts";
import { personalizeSystem } from "../../../../shared/ai/personalize";
import type { RecoveryPayload } from "../../../../shared/ai/payloads";

export async function handleRecovery(
  client: Anthropic,
  payload: RecoveryPayload,
  memoryContext: string,
): Promise<unknown> {
  const { blockerId, todayLog } = payload;
  const breakdown = payload.breakdown ?? payload.roadmap;

  // Record blocker signal for memory
  quickReflect("blocker_reported", {
    blockerId,
    date: new Date().toISOString().split("T")[0],
  });

  const response = await client.messages.create({
    model: getModelForTask("recovery"),
    max_tokens: 2048,
    system: personalizeSystem(RECOVERY_SYSTEM, memoryContext),
    messages: [
      {
        role: "user",
        content: `I missed some tasks today. The blocker was: "${blockerId}".

TODAY'S LOG:
${JSON.stringify(todayLog, null, 2)}

CURRENT GOAL BREAKDOWN:
${JSON.stringify(breakdown, null, 2)}

Please acknowledge, show impact, and adjust my plan.`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  const recoveryResult = JSON.parse(cleaned);

  // Recovery is a strong signal — run reflection in background
  runReflection(client, `recovery_blocker:${blockerId}`).catch((err) =>
    console.warn("Background reflection failed:", err),
  );

  return recoveryResult;
}
