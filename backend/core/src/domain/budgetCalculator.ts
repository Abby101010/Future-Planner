/* ──────────────────────────────────────────────────────────
   NorthStar — Dynamic Cognitive Budget Calculator (A-3)

   Pure function. Blends the user's static `dailyCognitiveBudget`
   with their CapacityProfile trend + recent completion rate, and
   applies the segment-based weekday multiplier that used to live
   inside the scheduler. Output is clamped to sensible bounds so
   a bad profile never zeros out the day.

   Defaults (trend="stable", recentCompletionRate=0.8) reproduce
   the pre-A-3 scheduler's output byte-for-byte for the default
   case — this matters for the ARCHITECTURE_UPGRADES §9 invariant.
   ────────────────────────────────────────────────────────── */

import type { UserSegment } from "../types/index.js";

export const MIN_EFFECTIVE_BUDGET = 8;
export const MAX_EFFECTIVE_BUDGET = 40;

export type BudgetTrend = "improving" | "declining" | "stable";

export interface ComputeDynamicBudgetArgs {
  /** Static base from user settings (ensure the caller already applied its
   *  own `?? 22` default before calling — the calculator treats `base` as
   *  authoritative). */
  base: number;
  segment: UserSegment;
  /** JS Date.getDay() convention: 0=Sun..6=Sat. */
  dayOfWeek: number;
  trend?: BudgetTrend;
  /** 0..1 (or -1 when unknown — treated as neutral 0.8). */
  recentCompletionRate?: number;
}

export interface DynamicBudgetResult {
  effective: number;
  base: number;
  appliedMultipliers: {
    segMult: number;
    trendMult: number;
    completionMult: number;
  };
}

function segmentMultiplier(segment: UserSegment, dayOfWeek: number): number {
  if (segment === "side-project") {
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    return isWeekend ? 1.0 : 0.4;
  }
  return 1.0;
}

function trendMultiplier(trend: BudgetTrend | undefined): number {
  if (trend === "improving") return 1.1;
  if (trend === "declining") return 0.85;
  return 1.0;
}

function completionMultiplier(rate: number | undefined): number {
  // A rate of 0.8 is the neutral baseline (historical scheduler default).
  // < 0.8 scales down, > 0.8 scales up, clamped into a reasonable range.
  const r = typeof rate === "number" && rate >= 0 ? rate : 0.8;
  const raw = r / 0.8;
  if (raw < 0.7) return 0.7;
  if (raw > 1.2) return 1.2;
  return raw;
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

export function computeDynamicBudget(
  args: ComputeDynamicBudgetArgs,
): DynamicBudgetResult {
  const { base, segment, dayOfWeek, trend, recentCompletionRate } = args;
  const segMult = segmentMultiplier(segment, dayOfWeek);
  const trendMult = trendMultiplier(trend);
  const completionMult = completionMultiplier(recentCompletionRate);

  const raw = base * segMult * trendMult * completionMult;
  // Side-project weekday keeps its Phase-1 floor behavior (8) via global
  // MIN_EFFECTIVE_BUDGET. The max cap prevents runaway scaling if settings
  // drift into unrealistic territory.
  const effective = Math.round(
    clamp(raw, MIN_EFFECTIVE_BUDGET, MAX_EFFECTIVE_BUDGET),
  );

  return {
    effective,
    base,
    appliedMultipliers: { segMult, trendMult, completionMult },
  };
}
