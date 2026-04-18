/**
 * Overload Check — pure domain function for cognitive budget overload
 * detection and deferral recommendation generation.
 *
 * Extracted from `dailyPlanner/scenarios.ts` so the logic is reusable
 * across the daily task engine, scenario router, and client-side
 * pre-validation.
 *
 * Fairness strategy: goals with the most tasks "donate" first.
 * Never defer the last task from a goal — every goal gets attention.
 */

// ── Types ───────────────────────────────────────────────────

export interface OverloadTask {
  id: string;
  title: string;
  goalId: string | null;
  goalTitle: string;
  cognitiveWeight: number;
  durationMinutes: number;
  priority: string;
}

export interface DeferralRecommendation {
  taskId: string;
  title: string;
  goalId: string | null;
  goalTitle: string;
  cognitiveWeight: number;
  durationMinutes: number;
  reason: string;
}

export interface OverloadGoalBreakdown {
  goalId: string;
  goalTitle: string;
  taskCount: number;
  totalWeight: number;
}

export interface OverloadResult {
  overloaded: boolean;
  totalWeight: number;
  totalTasks: number;
  goalBreakdown: OverloadGoalBreakdown[];
  deferralRecommendations: DeferralRecommendation[];
}

// ── Main function ───────────────────────────────────────────

export function checkOverload(
  tasks: OverloadTask[],
  maxWeight: number,
  maxTasks: number,
): OverloadResult {
  const totalWeight = tasks.reduce((s, t) => s + t.cognitiveWeight, 0);
  const totalTasks = tasks.length;
  const overloaded = totalWeight > maxWeight || totalTasks > maxTasks;

  // Build per-goal breakdown
  const goalGroups = new Map<
    string,
    { goalTitle: string; tasks: OverloadTask[]; totalWeight: number }
  >();
  for (const t of tasks) {
    const key = t.goalId ?? "__user__";
    const group = goalGroups.get(key) ?? {
      goalTitle: t.goalTitle,
      tasks: [],
      totalWeight: 0,
    };
    group.tasks.push(t);
    group.totalWeight += t.cognitiveWeight;
    goalGroups.set(key, group);
  }

  const goalBreakdown: OverloadGoalBreakdown[] = [...goalGroups.entries()].map(
    ([goalId, g]) => ({
      goalId: goalId === "__user__" ? "" : goalId,
      goalTitle: g.goalTitle,
      taskCount: g.tasks.length,
      totalWeight: g.totalWeight,
    }),
  );

  // Generate deferral recommendations if overloaded
  const deferralRecommendations: DeferralRecommendation[] = [];

  if (overloaded) {
    const excessTasks = totalTasks - maxTasks;
    const excessWeight = totalWeight - maxWeight;

    if (excessTasks > 0 || excessWeight > 0) {
      // Sort candidates: goals with more tasks donate first (fairness),
      // then lowest priority defers first, then lightest tasks first.
      const candidates = tasks
        .map((t) => ({
          ...t,
          goalTaskCount:
            goalGroups.get(t.goalId ?? "__user__")!.tasks.length,
        }))
        .sort((a, b) => {
          if (a.goalTaskCount !== b.goalTaskCount)
            return b.goalTaskCount - a.goalTaskCount;
          const priRank = (p: string) =>
            p === "must-do" ? 0 : p === "should-do" ? 1 : 2;
          if (priRank(a.priority) !== priRank(b.priority))
            return priRank(b.priority) - priRank(a.priority);
          return a.cognitiveWeight - b.cognitiveWeight;
        });

      let remainingWeight = totalWeight;
      let remainingTasks = totalTasks;
      const goalRemaining = new Map<string, number>();
      for (const [key, g] of goalGroups)
        goalRemaining.set(key, g.tasks.length);

      for (const c of candidates) {
        if (remainingTasks <= maxTasks && remainingWeight <= maxWeight) break;
        const key = c.goalId ?? "__user__";
        if ((goalRemaining.get(key) ?? 0) <= 1) continue;

        deferralRecommendations.push({
          taskId: c.id,
          title: c.title,
          goalId: c.goalId,
          goalTitle: c.goalTitle,
          cognitiveWeight: c.cognitiveWeight,
          durationMinutes: c.durationMinutes,
          reason:
            c.goalTaskCount > 2
              ? `${c.goalTitle} has ${c.goalTaskCount} tasks today — spreading across days`
              : `Over daily budget (${totalWeight}/${maxWeight} weight, ${totalTasks}/${maxTasks} tasks)`,
        });
        goalRemaining.set(key, (goalRemaining.get(key) ?? 1) - 1);
        remainingWeight -= c.cognitiveWeight;
        remainingTasks -= 1;
      }
    }
  }

  return {
    overloaded,
    totalWeight,
    totalTasks,
    goalBreakdown,
    deferralRecommendations,
  };
}
