/* Starward server — Plan-adjustment Level 2 (goal-scoped regen)
 *
 * The 2% case. Triggered by:
 *   - paceMismatch.maxSeverity = "high" (classifier auto-detection)
 *   - manual override "milestone-regen" via command:request-escalation
 *
 * Today's implementation: delegates to the existing
 * runLocalLevelReschedule via cmdAdaptiveReschedule(scopeOverride=
 * "local"). That path constrains its AI rewrite to ~2-4 weeks of
 * the goal's plan, not the whole plan, so token cost is bounded.
 *
 * Honest gap (deferred): true *milestone-within-goal* scoping
 * requires runLocalLevelReschedule to accept a milestoneId override
 * and filter targetWeeks to that milestone's date range. The
 * classifier output already carries `affectedMilestoneIds`, but the
 * local handler currently ignores it for week selection (uses it
 * only for the prompt's MILESTONE CONTEXT line). When a future
 * iteration wants per-milestone rewrites, extend the local handler
 * to slice `weekList` by milestone date range and route here.
 *
 * What L2 gives over L1 today: it's an EXPLICIT escalation path
 * (manual override or high-severity auto-trigger) so plan_adjustments
 * carries level=2 for analytics. The actual AI work is the same
 * shape as L1's per-goal call.
 */

import * as repos from "../repositories";
import { withLlmCallContext } from "./llmUsageLogger";
import { getEffectiveDate } from "../dateUtils";

export interface L2Result {
  goalId: string;
  milestoneId: string;
  succeeded: boolean;
  reason?: string;
}

/** Run the L2 milestone-scope handler. Caller supplies the goal +
 *  milestone to rewrite. The classifier's `paceMismatch.maxSeverity`
 *  signal is the typical trigger; manual escalation is the other. */
export async function runL2MilestoneScope(args: {
  goalId: string;
  milestoneId: string;
  rationale: string;
  date?: string;
}): Promise<L2Result> {
  const date = args.date ?? getEffectiveDate();
  const result: L2Result = {
    goalId: args.goalId,
    milestoneId: args.milestoneId,
    succeeded: false,
  };

  const cmdAdaptive = await import("../routes/commands/planning");

  try {
    await withLlmCallContext(
      {
        kind: "L2-milestone-regen",
        trigger: `L2-milestone-regen:${date}`,
        extra: { goalId: args.goalId, milestoneId: args.milestoneId },
      },
      async () => {
        // Goal-scoped local rewrite. Until runLocalLevelReschedule is
        // taught to filter targetWeeks by milestone date range, the
        // milestoneId is recorded for audit/telemetry but doesn't
        // narrow the AI's rewrite below the goal level.
        await cmdAdaptive.cmdAdaptiveReschedule({
          goalId: args.goalId,
          scopeOverride: "local",
        });
      },
    );
    result.succeeded = true;
  } catch (err) {
    result.reason = err instanceof Error ? err.message : String(err);
    console.warn(`[L2] milestone regen failed for ${args.goalId}/${args.milestoneId}:`, result.reason);
  }

  try {
    await repos.planAdjustments.insert({
      id: `L2-${date}-${Date.now()}`,
      goalId: args.goalId,
      level: 2,
      scope: "milestone",
      classifierInput: { milestoneId: args.milestoneId },
      rationale: args.rationale,
      actions: [
        {
          kind: result.succeeded ? "milestone-rewritten" : "milestone-failed",
          milestoneId: args.milestoneId,
          ...(result.reason ? { reason: result.reason } : {}),
        },
      ],
    });
  } catch (err) {
    console.warn("[L2] plan_adjustments insert failed:", err);
  }

  return result;
}
