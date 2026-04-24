/* Starward server — Critique orchestration
 *
 * `runCritique` is the fire-and-forget entry point. Callers invoke it without
 * awaiting; it runs the Haiku critique agent in the background, emits the
 * `agent:critique` WS event on completion, and swallows every error so the
 * primary flow is never disturbed.
 *
 * Usage (from a route handler):
 *
 *   const result = await runGoalPlan(...);
 *   res.json(result);                                     // primary ships
 *   void runCritique({                                    // detached
 *     userId: req.userId,
 *     handler: "generate-goal-plan",
 *     primaryOutput: result,
 *     memoryContext,
 *     payload,
 *     correlationId: undefined,
 *   });
 */

import { getClient } from "../ai/client";
import { emitAgentCritique } from "../ws/events";
import { runCritiqueAgent } from "./agent";
import type { RawCritique } from "./agent";

export type { RawCritique } from "./agent";

export interface CritiqueRequest {
  userId: string;
  handler: string;
  primaryOutput: unknown;
  memoryContext: string;
  payload: unknown;
  correlationId?: string;
}

/**
 * Run a critique pass in the background. Always returns quickly; the caller
 * should NOT await this Promise (prefix with `void`).
 *
 * Errors are logged and swallowed — a failed critique is never visible to the
 * user and never affects the primary handler's response.
 */
export async function runCritique(req: CritiqueRequest): Promise<void> {
  try {
    const client = getClient();
    if (!client) {
      console.warn("[critique] skipping: ANTHROPIC_API_KEY not configured");
      return;
    }
    const startedAt = Date.now();
    const critique: RawCritique = await runCritiqueAgent(client, {
      handler: req.handler,
      primaryOutput: req.primaryOutput,
      memoryContext: req.memoryContext,
      payload: req.payload,
    });
    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[critique] ${req.handler}: ${critique.overallAssessment} (${critique.issues.length} issue(s), ${elapsedMs}ms)`,
    );
    emitAgentCritique(req.userId, {
      handler: req.handler,
      correlationId: req.correlationId,
      overallAssessment: critique.overallAssessment,
      issues: critique.issues,
      summary: critique.summary,
    });
  } catch (err) {
    console.error(`[critique] ${req.handler} failed:`, err);
  }
}
