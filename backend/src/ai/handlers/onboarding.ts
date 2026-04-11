/* NorthStar — Onboarding handler (multi-turn conversation) */

import Anthropic from "@anthropic-ai/sdk";
import { getModelForTask } from "../../model-config";
import { ONBOARDING_SYSTEM } from "../prompts";
import { personalizeSystem } from "../personalize";

export async function handleOnboarding(
  client: Anthropic,
  payload: Record<string, unknown>,
  memoryContext: string,
): Promise<string> {
  const messages = (
    payload.messages as Array<{ role: string; content: string }>
  ).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  messages.push({ role: "user", content: payload.userInput as string });

  const response = await client.messages.create({
    model: getModelForTask("onboarding"),
    max_tokens: 1024,
    system: personalizeSystem(ONBOARDING_SYSTEM, memoryContext),
    messages,
  });

  const block = response.content[0];
  return block.type === "text" ? block.text : "";
}
