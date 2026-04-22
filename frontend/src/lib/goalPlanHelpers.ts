/* ──────────────────────────────────────────────────────────
   NorthStar — Goal plan helpers

   Phase 7: only `computeMilestoneProgress` is still used (by
   GoalPlanPage for the milestone progress bar). All the other
   helpers (toggle/merge/patch/unlock) moved server-side into the
   goal command handlers, so they were deleted from this file.

   Add new helpers here only if they're pure derivations of a plan
   — anything that mutates state should be a command on the server.
   ────────────────────────────────────────────────────────── */

import type { GoalPlan, GoalPlanTask, GoalPlanMilestone } from "@northstar/core";

function flattenPlanTasks(plan: GoalPlan): GoalPlanTask[] {
  const tasks: GoalPlanTask[] = [];
  for (const yr of plan.years) {
    for (const mo of yr.months) {
      for (const wk of mo.weeks) {
        for (const dy of wk.days) {
          tasks.push(...dy.tasks);
        }
      }
    }
  }
  return tasks;
}

// Distributes tasks evenly across milestones (milestone i owns segment i
// of the total). Each milestone gets a progressPercent [0-100].
export function computeMilestoneProgress(
  plan: GoalPlan,
): Array<
  GoalPlanMilestone & {
    progressPercent: number;
    segmentCompleted: number;
    segmentTotal: number;
  }
> {
  const allTasks = flattenPlanTasks(plan);
  const milestones = plan.milestones;
  if (milestones.length === 0) return [];

  const totalTasks = allTasks.length;
  const perMilestone =
    totalTasks > 0 ? Math.ceil(totalTasks / milestones.length) : 0;

  return milestones.map((ms, i) => {
    const start = i * perMilestone;
    const end = Math.min(start + perMilestone, totalTasks);
    const segment = allTasks.slice(start, end);
    const segmentTotal = segment.length;
    const segmentCompleted = segment.filter((t) => t.completed).length;
    const progressPercent =
      segmentTotal > 0
        ? Math.round((segmentCompleted / segmentTotal) * 100)
        : 0;
    const isFullyDone = segmentTotal > 0 && segmentCompleted === segmentTotal;

    return {
      ...ms,
      completed: ms.completed || isFullyDone,
      progressPercent,
      segmentCompleted,
      segmentTotal,
    };
  });
}
