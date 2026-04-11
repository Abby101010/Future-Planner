/* NorthStar — Analyze Monthly Context handler */

import Anthropic from "@anthropic-ai/sdk";
import { getModelForTask } from "../../model-config";
import { ANALYZE_MONTHLY_CONTEXT_SYSTEM } from "../prompts";
import { personalizeSystem } from "../personalize";
import type { AnalyzeMonthlyContextPayload } from "../payloads";

export async function handleAnalyzeMonthlyContext(
  client: Anthropic,
  payload: AnalyzeMonthlyContextPayload,
  memoryContext: string,
): Promise<unknown> {
  const { month, description } = payload;

  const response = await client.messages.create({
    model: getModelForTask("analyze-monthly-context"),
    max_tokens: 256,
    system: personalizeSystem(ANALYZE_MONTHLY_CONTEXT_SYSTEM, memoryContext),
    messages: [
      {
        role: "user",
        content: `Month: ${month}\n\nMy situation this month: ${description}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  // Extract just the JSON object — AI sometimes adds trailing explanation text
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No valid JSON found in response");
  return JSON.parse(jsonMatch[0]);
}
