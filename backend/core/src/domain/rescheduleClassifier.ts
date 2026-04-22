/* ──────────────────────────────────────────────────────────
   NorthStar — Reschedule Classifier (Initiative B Phase 1)

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
