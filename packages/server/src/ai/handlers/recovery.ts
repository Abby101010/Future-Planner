/* NorthStar — Recovery handler */

import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { runReflection } from "../../reflection";
import { query } from "../../db/pool";
import { getCurrentUserId } from "../../middleware/requestContext";
import { getModelForTask } from "@northstar/core";
import { RECOVERY_SYSTEM } from "@northstar/core";
import { personalizeSystem } from "@northstar/core";
import type { RecoveryPayload } from "@northstar/core";
import { runStreamingHandler } from "../streaming";
import { emitAgentProgress } from "../../ws";

export async function handleRecovery(
  client: Anthropic,
  payload: RecoveryPayload,
  memoryContext: string,
): Promise<unknown> {
  const { blockerId, todayLog } = payload;
  const breakdown = payload.breakdown ?? payload.roadmap;
  const userId = getCurrentUserId();

  // Record blocker signal for memory (mirrors quickReflect("blocker_reported"))
  const today = new Date().toISOString().split("T")[0];
  await query(
    `insert into memory_signals (id, user_id, type, context, value, timestamp)
       values ($1, $2, 'blocker_reported', $3, $4, now())`,
    [`sig-${randomUUID()}`, userId, blockerId, `Reported on ${today}`],
  );
  await query(
    `insert into memory_signals (id, user_id, type, context, value, timestamp)
       values ($1, $2, 'recovery_triggered', 'recovery', $3, now())`,
    [`sig-${randomUUID()}`, userId, blockerId],
  );

  const handlerKind = "recovery";
  emitAgentProgress(userId, {
    agentId: handlerKind,
    phase: "running",
    message: "Planning recovery",
  });

  const recoveryResult = await runStreamingHandler<unknown>({
    handlerKind,
    client,
    createRequest: () => ({
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
    }),
    parseResult: (finalText) => {
      const cleaned = finalText
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      return JSON.parse(cleaned);
    },
  });

  emitAgentProgress(userId, { agentId: handlerKind, phase: "done" });

  // Recovery is a strong signal — run reflection in background
  runReflection(client, userId, `recovery_blocker:${blockerId}`).catch((err) =>
    console.warn("Background reflection failed:", err),
  );

  return recoveryResult;
}
