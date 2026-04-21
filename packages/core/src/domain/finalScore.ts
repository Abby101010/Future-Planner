/* ──────────────────────────────────────────────────────────
   NorthStar — Two-Channel Arbitration (A-4)

   Pure function. Blends three signals into a single within-tier
   ordering key so a hot quarter-tier task can edge out a stale
   lifetime-tier task when recency + gatekeeper score warrant.

     finalScore = tierWeight * 0.5
                + (priorityScore / 10) * 0.3
                + recencyBoost * 0.2

   Tier weights are chosen so lifetime still dominates by default
   (10 → 5.0 vs. quarter 7 → 3.5), but a priorityScore of 90 or
   a same-day recency boost can close the gap for a lower-tier
   task.

   `recencyBoost = max(0, 1 - daysSinceLastWorked / 30)` — 1 when
   the goal was touched today, 0 when idle 30+ days.

   Missing inputs default to neutral:
     - priorityScore  → 50  (middle of 0..100)
     - daysSinceLastWorked → 30 (no boost)
   So an unannotated task doesn't explode the ranking.
   ────────────────────────────────────────────────────────── */

export type FinalScoreTier = "lifetime" | "quarter" | "week" | "day";

export const TIER_WEIGHTS: Record<FinalScoreTier, number> = {
  lifetime: 10,
  quarter: 7,
  week: 4,
  day: 1,
};

const TIER_COEF = 0.5;
const PRIORITY_COEF = 0.3;
const RECENCY_COEF = 0.2;

export interface FinalScoreArgs {
  tier: FinalScoreTier;
  /** 0..100 from the gatekeeper. `undefined` treated as 50 (neutral). */
  priorityScore: number | undefined;
  /** Days since the task's goal was last worked. `undefined` → 30 (no boost). */
  daysSinceLastWorked: number | undefined;
}

export interface FinalScoreBreakdown {
  tierComponent: number;
  priorityComponent: number;
  recencyComponent: number;
  finalScore: number;
}

export function computeFinalScore(args: FinalScoreArgs): number {
  return computeFinalScoreBreakdown(args).finalScore;
}

export function computeFinalScoreBreakdown(
  args: FinalScoreArgs,
): FinalScoreBreakdown {
  const weight = TIER_WEIGHTS[args.tier] ?? 1;
  const pScore =
    typeof args.priorityScore === "number" && args.priorityScore >= 0
      ? args.priorityScore
      : 50;
  const days =
    typeof args.daysSinceLastWorked === "number" && args.daysSinceLastWorked >= 0
      ? args.daysSinceLastWorked
      : 30;
  const recencyBoost = Math.max(0, 1 - days / 30);

  const tierComponent = weight * TIER_COEF;
  const priorityComponent = (pScore / 10) * PRIORITY_COEF;
  const recencyComponent = recencyBoost * RECENCY_COEF;

  return {
    tierComponent,
    priorityComponent,
    recencyComponent,
    finalScore: tierComponent + priorityComponent + recencyComponent,
  };
}
