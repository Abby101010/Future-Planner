/* Cross-goal pace allocator.
 *
 * Divides the user's measured daily pace among active big goals
 * proportional to goal importance. Used by batch-reschedule flows
 * (cmdAdjustAllOverloadedPlans) so each goal's planner sees only its
 * fair share of daily capacity, not the full user pace.
 *
 * ⚠ Invariant: any handler that triggers multiple plan regenerations
 * in a single user action must call this first and pass each goal's
 * slice into the per-goal reschedule via `paceOverride`. Otherwise N
 * goals each claim the full user pace and the user ends up right back
 * in the same overload state that triggered the adjustment.
 *
 * Deterministic by design. If we later need the allocator to reason
 * about imminent deadlines or streak-driven priority (things math
 * can't easily capture), upgrade to an LLM sub-agent — but start
 * simple and audit the allocations first. The single-goal
 * `cmdAdaptiveReschedule` path is unchanged by this module.
 *
 * This is a sibling to `detectCrossGoalOverload` in
 * @starward/core/domain/paceDetection.ts, which uses the same
 * importance-weighted math to *advise* the user. The two helpers
 * deliberately don't share code: detection skips goals that are on
 * track (no advisory needed), allocation does not (every eligible
 * goal needs a slice). Fusing them would obscure both intents.
 */

import type { Goal } from "@starward/core";

const IMPORTANCE_WEIGHT: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export interface PaceAllocation {
  /** Fair share in tasks/day per goal, proportional to importance
   *  weight. Sum equals `totalUserPace` (modulo floating-point).
   *  Goals not in `allocatedGoalIds` are absent from this map. */
  paceByGoalId: Record<string, number>;
  /** Goals that were considered eligible — active big goals with a
   *  confirmed plan that aren't paused/archived/completed. */
  allocatedGoalIds: string[];
  /** The user pace that was divided. Echoed for log + audit. */
  totalUserPace: number;
}

/** Allocate `userPace` (user's measured daily task pace) across the
 *  eligible big goals using importance-weighted fair share. */
export function allocatePace(
  goals: Goal[],
  userPace: number,
): PaceAllocation {
  const eligible = goals.filter(
    (g) =>
      (g.goalType === "big" || (!g.goalType && g.scope === "big")) &&
      g.planConfirmed &&
      g.status !== "archived" &&
      g.status !== "completed" &&
      g.status !== "paused",
  );

  if (eligible.length === 0 || userPace <= 0) {
    return {
      paceByGoalId: {},
      allocatedGoalIds: [],
      totalUserPace: userPace,
    };
  }

  const totalWeight = eligible.reduce(
    (s, g) => s + (IMPORTANCE_WEIGHT[g.importance ?? "medium"] ?? 2),
    0,
  );

  const paceByGoalId: Record<string, number> = {};
  for (const g of eligible) {
    const w = IMPORTANCE_WEIGHT[g.importance ?? "medium"] ?? 2;
    paceByGoalId[g.id] = Math.round((w / totalWeight) * userPace * 100) / 100;
  }

  return {
    paceByGoalId,
    allocatedGoalIds: eligible.map((g) => g.id),
    totalUserPace: userPace,
  };
}
