/**
 * Effort Router — Haiku rapid classifier.
 *
 * Given a user message + context, classifies whether the request
 * needs HIGH effort (Opus + research + personalization) or LOW
 * effort (Sonnet quick processing).
 */

import { getClient } from "../ai/client";
import { getModelForTask } from "@northstar/core";
import { EFFORT_ROUTER_SYSTEM } from "@northstar/core";

export interface EffortRouterInput {
  userMessage: string;
  existingGoals: Array<{ title: string; goalType: string; status: string }>;
  todayTaskCount: number;
  currentCognitiveLoad: number;
}

export interface EffortRouterResult {
  effort: "high" | "low";
  reasoning: string;
}

export async function routeEffort(
  input: EffortRouterInput,
): Promise<EffortRouterResult> {
  const client = getClient();
  if (!client) throw new Error("ANTHROPIC_API_KEY not configured");
  const model = getModelForTask("effort-router");

  const userContext = [
    `Active goals: ${input.existingGoals.map((g) => `${g.title} (${g.goalType}, ${g.status})`).join(", ") || "none"}`,
    `Today's tasks: ${input.todayTaskCount}`,
    `Current cognitive load: ${input.currentCognitiveLoad}/12`,
  ].join("\n");

  const response = await client.messages.create({
    model,
    max_tokens: 256,
    system: EFFORT_ROUTER_SYSTEM,
    messages: [
      {
        role: "user",
        content: `## Current Context\n${userContext}\n\n## User Message\n${input.userMessage}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  try {
    // Extract JSON from response (may have markdown fences)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as EffortRouterResult;
      if (parsed.effort === "high" || parsed.effort === "low") {
        return parsed;
      }
    }
  } catch {
    // Fall through to default
  }

  // Default to low effort if parsing fails — safer than burning Opus tokens
  return { effort: "low", reasoning: "Default: could not parse effort classification" };
}
