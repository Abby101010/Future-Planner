/* Starward — Pace Explainer handler (TextGrad feedback)
 *
 * After the local pace detection identifies a moderate or severe
 * mismatch, this handler generates a human-readable explanation
 * and actionable suggestions. Light tier (Haiku) — fast and cheap.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getModelForTask, personalizeSystem } from "@starward/core";
import type { PaceMismatch } from "@starward/core";
import { runStreamingHandler } from "../streaming";

const PACE_EXPLAINER_SYSTEM = `You are a supportive goal coach. Given pace mismatch data, generate:
1. A brief explanation (2-3 sentences) of why the user is falling behind
2. 1-2 actionable suggestions to get back on track

Be encouraging, not judgmental. Focus on what they CAN do, not what they missed.

OUTPUT FORMAT (JSON only):
{
  "explanation": "...",
  "suggestions": ["...", "..."]
}`;

export interface PaceExplainerResult {
  explanation: string;
  suggestions: string[];
}

export async function handlePaceExplainer(
  client: Anthropic,
  mismatch: PaceMismatch,
  memoryContext: string,
): Promise<PaceExplainerResult> {
  const result = await runStreamingHandler<PaceExplainerResult>({
    handlerKind: "paceExplainer",
    client,
    createRequest: () => ({
      model: getModelForTask("pace-explainer"),
      max_tokens: 1024,
      system: personalizeSystem(PACE_EXPLAINER_SYSTEM, memoryContext),
      messages: [
        {
          role: "user",
          content: `GOAL: ${mismatch.goalTitle}
SEVERITY: ${mismatch.severity}

PACE DATA:
- Plan assumed ${mismatch.planTasksPerDay.toFixed(1)} tasks/day
- User completing ${mismatch.actualTasksPerDay.toFixed(1)} tasks/day
- ${mismatch.completedPlanTasks}/${mismatch.totalPlanTasks} tasks done
- ${mismatch.remainingTasks} tasks remaining
- ${mismatch.daysRemaining} days left
- Need ${mismatch.requiredTasksPerDay.toFixed(1)} tasks/day to finish on time
- Estimated delay: ${mismatch.estimatedDelayDays} days

Explain and suggest.`,
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

  return {
    explanation: result.explanation || "Pace is behind schedule.",
    suggestions: Array.isArray(result.suggestions) ? result.suggestions : [],
  };
}
