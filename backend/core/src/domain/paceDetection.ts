/**
 * Pace Detection & Overload Analysis — Pure Domain Logic
 *
 * All functions are deterministic (pure math, no AI, no network).
 * Runs on both client and server via @starward/core.
 *
 * - detectPaceMismatches: single-goal pace vs actual completion rate
 * - detectCrossGoalOverload: multi-goal capacity vs daily budget
 * - splitPlan / mergePlans: plan manipulation for rescheduling
 */

import type {
  Goal,
  GoalPlan,
  GoalPlanTask,
  GoalPlanYear,
  PaceMismatch,
  OverloadAdvisory,
} from "../types/index.js";

export type { PaceMismatch, OverloadAdvisory };

export interface PlanSplit {
  pastPlan: GoalPlan;
  futurePlan: GoalPlan;
  overdueTasks: Array<GoalPlanTask & { originalDay: string; originalWeek: string }>;
}

// ── Helpers ──────────────────────────────────────────────

function weekEndDate(wk: GoalPlanYear["months"][number]["weeks"][number]): string | null {
  for (let i = (wk.days ?? []).length - 1; i >= 0; i--) {
    const label = wk.days[i]?.label;
    if (label && /^\d{4}-\d{2}-\d{2}$/.test(label)) return label;
  }
  return null;
}

function normalizePlanArrays(plan: GoalPlan): GoalPlan {
  return {
    milestones: plan.milestones ?? [],
    years: (plan.years ?? []).map((yr) => ({
      ...yr,
      months: (yr.months ?? []).map((mo) => ({
        ...mo,
        weeks: (mo.weeks ?? []).map((wk) => ({
          ...wk,
          days: (wk.days ?? []).map((d) => ({
            ...d,
            tasks: d.tasks ?? [],
          })),
        })),
      })),
    })),
  };
}

export function countPlanStats(plan: GoalPlan) {
  let total = 0;
  let completed = 0;
  let totalDays = 0;
  for (const yr of plan.years ?? []) {
    for (const mo of yr.months) {
      for (const wk of mo.weeks) {
        for (const dy of wk.days) {
          totalDays++;
          for (const tk of dy.tasks) {
            total++;
            if (tk.completed) completed++;
          }
        }
      }
    }
  }
  const planTasksPerDay = totalDays > 0 ? total / totalDays : 0;
  return { total, completed, totalDays, planTasksPerDay };
}

// ── Plan Split / Merge ──────────────────────────────────

export function splitPlan(plan: GoalPlan, today?: string): PlanSplit {
  const todayStr = today ?? new Date().toISOString().split("T")[0];
  const pastYears: GoalPlanYear[] = [];
  const futureYears: GoalPlanYear[] = [];
  const overdueTasks: PlanSplit["overdueTasks"] = [];

  for (const yr of plan.years ?? []) {
    const pastMonths = [];
    const futureMonths = [];
    for (const mo of yr.months) {
      const pastWeeks = [];
      const futureWeeks = [];
      for (const wk of mo.weeks) {
        const endDate = weekEndDate(wk);
        const isPast = endDate ? endDate < todayStr : wk.locked;
        if (isPast) {
          pastWeeks.push(wk);
          for (const dy of wk.days ?? []) {
            for (const tk of dy.tasks ?? []) {
              if (!tk.completed) {
                overdueTasks.push({ ...tk, originalDay: dy.label, originalWeek: wk.label });
              }
            }
          }
        } else {
          futureWeeks.push(wk);
        }
      }
      if (pastWeeks.length > 0) pastMonths.push({ ...mo, weeks: pastWeeks });
      if (futureWeeks.length > 0) futureMonths.push({ ...mo, weeks: futureWeeks });
    }
    if (pastMonths.length > 0) pastYears.push({ ...yr, months: pastMonths });
    if (futureMonths.length > 0) futureYears.push({ ...yr, months: futureMonths });
  }

  return {
    pastPlan: { milestones: plan.milestones ?? [], years: pastYears },
    futurePlan: { milestones: [], years: futureYears },
    overdueTasks,
  };
}

export function mergePlans(pastPlan: GoalPlan, futurePlan: GoalPlan): GoalPlan {
  const yearMap = new Map<string, GoalPlanYear>();

  for (const yr of pastPlan.years) {
    yearMap.set(yr.label, { ...yr, months: [...(yr.months ?? [])] });
  }

  for (const yr of futurePlan.years) {
    const existing = yearMap.get(yr.label);
    if (existing) {
      const monthMap = new Map(existing.months.map((m) => [m.label, m]));
      for (const mo of (yr.months ?? [])) {
        const existingMonth = monthMap.get(mo.label);
        if (existingMonth) {
          monthMap.set(mo.label, { ...existingMonth, weeks: [...(existingMonth.weeks ?? []), ...(mo.weeks ?? [])] });
        } else {
          monthMap.set(mo.label, mo);
        }
      }
      yearMap.set(yr.label, { ...existing, months: [...monthMap.values()] });
    } else {
      yearMap.set(yr.label, yr);
    }
  }

  return normalizePlanArrays({ milestones: pastPlan.milestones ?? [], years: [...yearMap.values()] });
}

// ── Single-Goal Pace Mismatch Detection ─────────────────

export function detectPaceMismatches(
  goals: Goal[],
  avgTasksCompletedPerDay: number,
  today: string,
): PaceMismatch[] {
  const mismatches: PaceMismatch[] = [];

  for (const g of goals) {
    if (g.status === "archived" || g.status === "completed") continue;
    if (g.goalType !== "big" && !((!g.goalType) && g.scope === "big")) continue;
    if (!g.plan || !Array.isArray(g.plan.years)) continue;
    if (!g.planConfirmed) continue;

    const stats = countPlanStats(g.plan);
    if (stats.total === 0) continue;

    const remaining = stats.total - stats.completed;
    if (remaining === 0) continue;

    const targetDate = g.targetDate;
    let daysRemaining = 90;
    if (targetDate) {
      const diff = (new Date(targetDate).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24);
      daysRemaining = Math.max(1, Math.round(diff));
    }

    const requiredTasksPerDay = remaining / daysRemaining;
    const actualPace = avgTasksCompletedPerDay > 0 ? avgTasksCompletedPerDay : 1;
    const daysNeeded = remaining / actualPace;
    const estimatedDelayDays = Math.max(0, Math.round(daysNeeded - daysRemaining));

    let severity: PaceMismatch["severity"] = "mild";
    if (requiredTasksPerDay > actualPace * 1.5 || estimatedDelayDays > 14) {
      severity = "severe";
    } else if (requiredTasksPerDay > actualPace * 1.2 || estimatedDelayDays > 7) {
      severity = "moderate";
    }

    if (severity === "mild") continue;

    mismatches.push({
      goalId: g.id,
      goalTitle: g.title,
      planTasksPerDay: Math.round(stats.planTasksPerDay * 10) / 10,
      actualTasksPerDay: Math.round(actualPace * 10) / 10,
      totalPlanTasks: stats.total,
      completedPlanTasks: stats.completed,
      remainingTasks: remaining,
      daysRemaining,
      requiredTasksPerDay: Math.round(requiredTasksPerDay * 10) / 10,
      severity,
      estimatedDelayDays,
    });
  }

  return mismatches.sort((a, b) => {
    const sev = { severe: 0, moderate: 1, mild: 2 };
    return sev[a.severity] - sev[b.severity];
  });
}

// ── Cross-Goal Overload Detection ───────────────────────

const IMPORTANCE_WEIGHT: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

function freqLabel(tasksPerWeek: number): string {
  if (tasksPerWeek >= 6) return "daily";
  if (tasksPerWeek >= 4) return "5x/week";
  if (tasksPerWeek >= 3) return "3-4x/week";
  return "1-2x/week";
}

export function detectCrossGoalOverload(
  goals: Goal[],
  avgTasksCompletedPerDay: number,
  maxDailyTasks: number,
  today: string,
): OverloadAdvisory[] {
  const activeGoals = goals.filter(
    (g) =>
      (g.goalType === "big" || ((!g.goalType) && g.scope === "big")) &&
      g.planConfirmed &&
      g.plan &&
      Array.isArray(g.plan.years) &&
      g.status !== "archived" &&
      g.status !== "completed",
  );

  if (activeGoals.length <= maxDailyTasks) return [];
  if (avgTasksCompletedPerDay <= 0) return [];

  const totalWeight = activeGoals.reduce(
    (s, g) => s + (IMPORTANCE_WEIGHT[g.importance ?? "medium"] ?? 2),
    0,
  );

  const advisories: OverloadAdvisory[] = [];

  for (const g of activeGoals) {
    const stats = countPlanStats(g.plan!);
    const remaining = stats.total - stats.completed;
    if (remaining <= 0) continue;

    const weight = IMPORTANCE_WEIGHT[g.importance ?? "medium"] ?? 2;
    const fairSharePerDay = (weight / totalWeight) * avgTasksCompletedPerDay;
    const fairSharePerWeek = fairSharePerDay * 7;

    const daysNeeded = Math.ceil(remaining / Math.max(fairSharePerDay, 0.05));
    const suggestedDate = new Date(today + "T00:00:00");
    suggestedDate.setDate(suggestedDate.getDate() + daysNeeded);
    const suggestedTargetDate = suggestedDate.toISOString().split("T")[0];

    const currentTarget = g.targetDate || null;
    if (currentTarget && suggestedTargetDate <= currentTarget) continue;

    advisories.push({
      goalId: g.id,
      goalTitle: g.title,
      goalImportance: g.importance ?? "medium",
      currentTasksPerDay: Math.round(stats.planTasksPerDay * 10) / 10,
      suggestedTasksPerDay: Math.round(fairSharePerDay * 100) / 100,
      suggestedFreqLabel: freqLabel(fairSharePerWeek),
      currentTargetDate: currentTarget,
      suggestedTargetDate,
      remainingTasks: remaining,
      totalActiveGoals: activeGoals.length,
    });
  }

  return advisories.sort(
    (a, b) => (IMPORTANCE_WEIGHT[a.goalImportance] ?? 2) - (IMPORTANCE_WEIGHT[b.goalImportance] ?? 2),
  );
}
