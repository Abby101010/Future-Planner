/* NorthStar — Pace Check handler */

import Anthropic from "@anthropic-ai/sdk";
import { runReflection } from "../../reflection";
import { getCurrentUserId } from "../../middleware/requestContext";
import { getModelForTask } from "@northstar/core";
import { PACE_CHECK_SYSTEM } from "@northstar/core";
import { personalizeSystem } from "@northstar/core";
import type { PaceCheckPayload } from "@northstar/core";
import { runStreamingHandler } from "../streaming";
import { emitAgentProgress } from "../../ws";

export async function handlePaceCheck(
  client: Anthropic,
  payload: PaceCheckPayload,
  memoryContext: string,
): Promise<unknown> {
  const breakdown = payload.breakdown ?? payload.roadmap;
  const { logs } = payload;

  const handlerKind = "paceCheck";
  const userId = getCurrentUserId();
  emitAgentProgress(userId, {
    agentId: handlerKind,
    phase: "running",
    message: "Running pace check",
  });

  const result = await runStreamingHandler<unknown>({
    handlerKind,
    client,
    createRequest: () => ({
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

  // Pace check is a natural reflection trigger — run in background
  runReflection(client, userId, "weekly_pace_check").catch((err) =>
    console.warn("Background reflection failed:", err),
  );

  return result;
}
