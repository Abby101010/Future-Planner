/* ──────────────────────────────────────────────────────────
   Starward — Reschedule Classifier (Initiative B Phase 1)

   Pure function that picks a reschedule scope (micro | local |
   plan) from the shape of the slippage. Runs BEFORE any AI call
   so the coordinator can route to the right rewriter.

   See /Users/sophiecao/.claude/plans/i-need-to-upgrade-zesty-map.md
   for the full rule table and design rationale.
   ────────────────────────────────────────────────────────── */

import type { GoalPlanMilestone } from "../types/index.js";

export type RescheduleLevel = "micro" | "local" | "plan";

export interface RescheduleClassifierOverdueTask {
  id: string;
  originalWeek: string;
  originalDay: string;
}

export interface RescheduleClassifierInput {
  overdueTasks: RescheduleClassifierOverdueTask[];
  milestones: GoalPlanMilestone[];
  avgTasksCompletedPerDay: number;
  /** Consecutive most-recent days with ≤ 1 completion. */
  lowCompletionStreakDays: number;
  scopeOverride?: RescheduleLevel | null;
}

export interface RescheduleClassifierOutput {
  level: RescheduleLevel;
  affectedTaskIds: string[];
  affectedMilestoneIds: string[];
  affectedWeekLabels: string[];
  reasoning: string;
}

const LEVELS: readonly RescheduleLevel[] = ["micro", "local", "plan"] as const;

function normalizeOverride(
  v: RescheduleLevel | string | null | undefined,
): RescheduleLevel | null {
  if (!v) return null;
  return (LEVELS as readonly string[]).includes(v) ? (v as RescheduleLevel) : null;
}

/** Last ISO date in a week-label range like "Jan 6 – Jan 12, 2026" or the
 *  raw week label if it's already an ISO date. We only need something
 *  comparable; if we can't parse, return null. */
function extractWeekEndDate(weekLabel: string): string | null {
  const isoMatches = weekLabel.match(/\d{4}-\d{2}-\d{2}/g);
  if (isoMatches && isoMatches.length > 0) return isoMatches[isoMatches.length - 1];
  return null;
}

function mapWeekToMilestone(
  weekLabel: string,
  milestones: GoalPlanMilestone[],
): string | null {
  const weekEnd = extractWeekEndDate(weekLabel);
  if (!weekEnd) return null;
  const withDates = milestones
    .map((m) => ({ m, d: /^\d{4}-\d{2}-\d{2}/.test(m.targetDate) ? m.targetDate.slice(0, 10) : null }))
    .filter((x): x is { m: GoalPlanMilestone; d: string } => x.d !== null)
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  for (const { m, d } of withDates) {
    if (d >= weekEnd) return m.id;
  }
  return null;
}

function decideLevel(input: RescheduleClassifierInput): {
  level: RescheduleLevel;
  reasoning: string;
} {
  const override = normalizeOverride(input.scopeOverride ?? null);
  if (override) {
    return { level: override, reasoning: `scopeOverride=${override}` };
  }
  if (input.lowCompletionStreakDays >= 14) {
    return {
      level: "plan",
      reasoning: `low-completion streak ${input.lowCompletionStreakDays} days ≥ 14`,
    };
  }
  const overdueCount = input.overdueTasks.length;
  if (overdueCount === 0) {
    return { level: "micro", reasoning: "no overdue tasks" };
  }
  const distinctWeeks = new Set(input.overdueTasks.map((t) => t.originalWeek));
  if (distinctWeeks.size >= 3) {
    return {
      level: "plan",
      reasoning: `overdue spans ${distinctWeeks.size} distinct weeks`,
    };
  }
  if (overdueCount >= 4) {
    return {
      level: "local",
      reasoning: `${overdueCount} overdue tasks across ${distinctWeeks.size} week(s)`,
    };
  }
  if (overdueCount <= 3 && distinctWeeks.size === 1) {
    return {
      level: "micro",
      reasoning: `${overdueCount} overdue tasks in a single week`,
    };
  }
  return {
    level: "local",
    reasoning: `${overdueCount} overdue tasks across ${distinctWeeks.size} week(s) (fallback)`,
  };
}

// ──────────────────────────────────────────────────────────
// Adjustment classifier (4-level, scoped) — Phase B addition
//
// Coexists with classifyReschedule above. The original API is goal-
// plan centric (micro/local/plan). This new one routes any plan-
// adjustment event — daily-task rollover, milestone slip, manual
// escalation request — to one of four levels with a scope axis.
//
// Pure function; no AI. Inputs are aggregates already produced by
// other services (markStaleAsSkipped, dailyTriage, paceDetection,
// lowCompletionStreak), so the classifier itself has no I/O.
//
// Threshold values are starting points. Recalibrate against
// llm_calls cost telemetry once Phase A has accumulated 2+ weeks
// of real usage.
// ──────────────────────────────────────────────────────────

export type AdjustmentLevel = 0 | 1 | 2 | 3;
export type AdjustmentScope = "task" | "day" | "milestone" | "plan";

export interface AdjustmentClassifierInput {
  /** Pending reschedule cards (incomplete past-day tasks 1-90 days
   *  old). Source: tasksView.pendingReschedules. */
  pendingReschedules: {
    count: number;
    daysOverdueSum: number;
    agedOutCount: number;
  };
  /** Triage shielding overflow (must-do tasks blocking cap demotion).
   *  Source: dailyTriage.lightTriage result.undemoted. */
  triage: { undemoted: number };
  /** Pace mismatch severity per active goal. Source: paceDetection. */
  paceMismatch?: { maxSeverity: "none" | "low" | "med" | "high" };
  /** Consecutive recent days with ≤1 completion. Source:
   *  lowCompletionStreak service. */
  lowCompletionStreakDays: number;
  /** When set, forces the classifier to that level regardless of
   *  thresholds. Used by command:request-escalation. */
  manualOverride?: { level: 1 | 2 | 3; reason: string };
  /** When set, used by L3 to enforce the 30-day rate limit. */
  goalLastFullRegenAt?: string | null;
  /** Days since lastFullRegenAt when the rate limit kicks in.
   *  Defaults to 30. Configurable for tests. */
  fullRegenCooldownDays?: number;
}

export interface AdjustmentClassifierOutput {
  level: AdjustmentLevel;
  scope: AdjustmentScope;
  rationale: string;
  /** True when L3 was requested but blocked by the rate limit. The
   *  caller should report this to the user instead of silently
   *  downgrading. */
  rateLimited?: boolean;
}

const DEFAULT_FULL_REGEN_COOLDOWN_DAYS = 30;

/** Pure 4-level classifier. No I/O, no AI. */
export function classifyAdjustment(
  input: AdjustmentClassifierInput,
): AdjustmentClassifierOutput {
  // Manual override path (L3 still honors the rate limit; L1/L2 do not)
  if (input.manualOverride) {
    if (input.manualOverride.level === 3) {
      const blocked = isRateLimited(input);
      if (blocked) {
        return {
          level: 1,
          scope: "day",
          rationale: `manual L3 requested but rate-limited (last full regen <${input.fullRegenCooldownDays ?? DEFAULT_FULL_REGEN_COOLDOWN_DAYS}d ago); downgraded to L1`,
          rateLimited: true,
        };
      }
      return {
        level: 3,
        scope: "plan",
        rationale: `manual override: ${input.manualOverride.reason}`,
      };
    }
    if (input.manualOverride.level === 2) {
      return {
        level: 2,
        scope: "milestone",
        rationale: `manual override: ${input.manualOverride.reason}`,
      };
    }
    return {
      level: 1,
      scope: "day",
      rationale: `manual override: ${input.manualOverride.reason}`,
    };
  }

  // L3 — automatic only on sustained severe underperformance
  if (input.lowCompletionStreakDays >= 42) {
    if (isRateLimited(input)) {
      return {
        level: 2,
        scope: "milestone",
        rationale: `lowCompletionStreak ${input.lowCompletionStreakDays}d would trigger L3, but rate-limited; running L2 instead`,
        rateLimited: true,
      };
    }
    return {
      level: 3,
      scope: "plan",
      rationale: `lowCompletionStreak ${input.lowCompletionStreakDays}d ≥ 42 (sustained severe underperformance)`,
    };
  }

  // L2 — milestone severely behind
  // (At classifier level we use pace severity as a proxy. Caller may
  // also pass manualOverride.level=2 for explicit "redo this milestone".)
  if (input.paceMismatch?.maxSeverity === "high") {
    return {
      level: 2,
      scope: "milestone",
      rationale: "pace mismatch severity = high (milestone significantly behind)",
    };
  }

  // L1 — moderate backlog or triage overflow
  const pr = input.pendingReschedules;
  if (
    pr.count > 5 ||
    pr.daysOverdueSum > 14 ||
    input.lowCompletionStreakDays >= 3 ||
    input.triage.undemoted > 0 ||
    pr.agedOutCount > 0
  ) {
    return {
      level: 1,
      scope: "day",
      rationale: l1Rationale(input),
    };
  }

  // L0 — pure algorithm path (target: ~90% of events)
  return {
    level: 0,
    scope: pr.count > 0 ? "day" : "task",
    rationale: "within all L0 thresholds",
  };
}

function isRateLimited(input: AdjustmentClassifierInput): boolean {
  if (!input.goalLastFullRegenAt) return false;
  const cooldownDays = input.fullRegenCooldownDays ?? DEFAULT_FULL_REGEN_COOLDOWN_DAYS;
  const last = new Date(input.goalLastFullRegenAt).getTime();
  if (isNaN(last)) return false;
  const elapsedDays = (Date.now() - last) / 86_400_000;
  return elapsedDays < cooldownDays;
}

function l1Rationale(input: AdjustmentClassifierInput): string {
  const reasons: string[] = [];
  const pr = input.pendingReschedules;
  if (pr.count > 5) reasons.push(`pendingReschedules.count=${pr.count}>5`);
  if (pr.daysOverdueSum > 14) reasons.push(`daysOverdueSum=${pr.daysOverdueSum}>14`);
  if (input.lowCompletionStreakDays >= 3) reasons.push(`lowCompletionStreak=${input.lowCompletionStreakDays}≥3`);
  if (input.triage.undemoted > 0) reasons.push(`triage.undemoted=${input.triage.undemoted}>0`);
  if (pr.agedOutCount > 0) reasons.push(`agedOutCount=${pr.agedOutCount}>0`);
  return reasons.join("; ");
}

// ──────────────────────────────────────────────────────────
// Original 3-level classifier (unchanged)
// ──────────────────────────────────────────────────────────

export function classifyReschedule(
  input: RescheduleClassifierInput,
): RescheduleClassifierOutput {
  const { level, reasoning } = decideLevel(input);

  const distinctWeeks = Array.from(
    new Set(input.overdueTasks.map((t) => t.originalWeek)),
  );

  const affectedTaskIds = input.overdueTasks.map((t) => t.id);

  let affectedMilestoneIds: string[];
  if (level === "plan") {
    affectedMilestoneIds = input.milestones.map((m) => m.id);
  } else {
    const resolved = new Set<string>();
    for (const wk of distinctWeeks) {
      const id = mapWeekToMilestone(wk, input.milestones);
      if (id) resolved.add(id);
    }
    affectedMilestoneIds = Array.from(resolved);
  }

  return {
    level,
    affectedTaskIds,
    affectedMilestoneIds,
    affectedWeekLabels: distinctWeeks,
    reasoning,
  };
}
