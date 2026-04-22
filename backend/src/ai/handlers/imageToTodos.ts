/* NorthStar — Image → Todos handler
 *
 * Accepts a base64-encoded image plus metadata, sends it to Claude via
 * the vision content block, and returns the structured todo list. The
 * server never persists the image — the base64 lives only in memory
 * for the duration of this request.
 */

import Anthropic from "@anthropic-ai/sdk";
import {
  getModelForTask,
  IMAGE_TO_TODOS_SYSTEM,
  personalizeSystem,
} from "@northstar/core";
import type { ImageToTodosPayload } from "@northstar/core";
import { runStreamingHandler } from "../streaming";
import { emitAgentProgress } from "../../ws";
import { getCurrentUserId } from "../../middleware/requestContext";

export async function handleImageToTodos(
  client: Anthropic,
  payload: ImageToTodosPayload,
  memoryContext: string,
): Promise<unknown> {
  const { imageBase64, mediaType, source, userHint, todayDate } = payload;
  const today = todayDate ?? new Date().toISOString().split("T")[0];

  const handlerKind = "imageToTodos";
  const userId = getCurrentUserId();
  emitAgentProgress(userId, {
    agentId: handlerKind,
    phase: "running",
    message: "Reading your image",
  });

  const hintBlock = userHint
    ? `USER HINT: "${userHint}"\n`
    : "";

  const textInstruction = `TODAY: ${today}
SOURCE: ${source}
${hintBlock}
Look at the image above and extract actionable todos. Follow the JSON
output format in the system prompt exactly. Return ONLY the JSON object.`;

  const result = await runStreamingHandler<unknown>({
    handlerKind,
    client,
    createRequest: () => ({
      model: getModelForTask("image-to-todos"),
      max_tokens: 2048,
      system: personalizeSystem(IMAGE_TO_TODOS_SYSTEM, memoryContext),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: imageBase64,
              },
            },
            {
              type: "text",
              text: textInstruction,
            },
          ],
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
  return result;
}
