/* ──────────────────────────────────────────────────────────
   Starward — Plan diff utility

   Pure function: compare two GoalPlan trees and report what
   changed at the milestone + task level. Used by:
     - goalPlanRepo.replacePlan to log overhaul events to
       plan_adjustments + emit a user-facing nudge when the
       change crosses the overhaul threshold.
     - command:plan-edit-classify to project impact BEFORE
       applying a proposed plan rewrite (FE preview).

   Comparison is by node `id`, not by position or content.
   That matches how plan_node_ids are persisted: an edit
   that retains the same id is a "modified", not "removed +
   added". Falsely treating a stable id as removed/re-added
   would explode the diff count and trip the overhaul rule.

   Comparison is content-aware for "modified": same id +
   different title/duration/description = modified. Only
   `completed` toggle changes are NOT counted as modifications
   (those are per-task progress events, not plan edits).
   ────────────────────────────────────────────────────────── */

import type {
  GoalPlan,
  GoalPlanMilestone,
  GoalPlanTask,
} from "../types/index.js";

export interface PlanDiff {
  milestones: {
    added: number;
    removed: number;
    modified: number;
    totalOld: number;
    totalNew: number;
  };
  tasks: {
    added: number;
    removed: number;
    modified: number;
    totalOld: number;
    totalNew: number;
  };
  /** Sum of all task-level changes (added + removed + modified). */
  totalTaskChanges: number;
  /** True when the change is large enough to count as an overhaul.
   *  Default rule: >40% of the larger side's tasks changed, OR
   *  >10 absolute task changes. Configurable via thresholds arg. */
  isOverhaul: boolean;
}

export interface PlanDiffThresholds {
  /** Fraction of `max(totalOld, totalNew)` task-changes that triggers
   *  overhaul classification. Default 0.4 (40%). */
  ratioThreshold?: number;
  /** Absolute task-change count that triggers overhaul classification
   *  regardless of ratio. Default 10. Useful to catch "rewrote a
   *  small plan from scratch" cases where ratio is meaningless. */
  absoluteThreshold?: number;
}

const DEFAULT_RATIO_THRESHOLD = 0.4;
const DEFAULT_ABSOLUTE_THRESHOLD = 10;

/** Walk every task in a plan, return as a flat map keyed by id. */
function collectTasks(plan: GoalPlan | null | undefined): Map<string, GoalPlanTask> {
  const out = new Map<string, GoalPlanTask>();
  if (!plan || !Array.isArray(plan.years)) return out;
  for (const year of plan.years) {
    if (!year?.months) continue;
    for (const month of year.months) {
      if (!month?.weeks) continue;
      for (const week of month.weeks) {
        if (!week?.days) continue;
        for (const day of week.days) {
          if (!day?.tasks) continue;
          for (const task of day.tasks) {
            if (task?.id) out.set(task.id, task);
          }
        }
      }
    }
  }
  return out;
}

function collectMilestones(
  plan: GoalPlan | null | undefined,
): Map<string, GoalPlanMilestone> {
  const out = new Map<string, GoalPlanMilestone>();
  if (!plan?.milestones) return out;
  for (const m of plan.milestones) {
    if (m?.id) out.set(m.id, m);
  }
  return out;
}

/** Has the task's plan-meaningful content changed? Excludes
 *  `completed`/`completedAt` because those are progress events, not
 *  plan-edit actions. */
function taskContentChanged(a: GoalPlanTask, b: GoalPlanTask): boolean {
  return (
    a.title !== b.title ||
    a.description !== b.description ||
    a.durationMinutes !== b.durationMinutes ||
    a.priority !== b.priority ||
    a.category !== b.category ||
    a.taskType !== b.taskType
  );
}

function milestoneContentChanged(
  a: GoalPlanMilestone,
  b: GoalPlanMilestone,
): boolean {
  return (
    a.title !== b.title ||
    a.description !== b.description ||
    a.targetDate !== b.targetDate
  );
}

/**
 * Diff two plans. Either side may be null/empty (initial plan
 * creation = old empty; plan deletion = new empty), in which case
 * everything reports as added or removed accordingly.
 */
export function diffPlans(
  oldPlan: GoalPlan | null | undefined,
  newPlan: GoalPlan | null | undefined,
  thresholds?: PlanDiffThresholds,
): PlanDiff {
  const oldTasks = collectTasks(oldPlan);
  const newTasks = collectTasks(newPlan);
  const oldMilestones = collectMilestones(oldPlan);
  const newMilestones = collectMilestones(newPlan);

  let taskAdded = 0;
  let taskRemoved = 0;
  let taskModified = 0;
  for (const [id, t] of newTasks) {
    const prev = oldTasks.get(id);
    if (!prev) taskAdded++;
    else if (taskContentChanged(prev, t)) taskModified++;
  }
  for (const id of oldTasks.keys()) {
    if (!newTasks.has(id)) taskRemoved++;
  }

  let milestoneAdded = 0;
  let milestoneRemoved = 0;
  let milestoneModified = 0;
  for (const [id, m] of newMilestones) {
    const prev = oldMilestones.get(id);
    if (!prev) milestoneAdded++;
    else if (milestoneContentChanged(prev, m)) milestoneModified++;
  }
  for (const id of oldMilestones.keys()) {
    if (!newMilestones.has(id)) milestoneRemoved++;
  }

  const totalTaskChanges = taskAdded + taskRemoved + taskModified;
  const ratioThreshold = thresholds?.ratioThreshold ?? DEFAULT_RATIO_THRESHOLD;
  const absoluteThreshold =
    thresholds?.absoluteThreshold ?? DEFAULT_ABSOLUTE_THRESHOLD;
  const denom = Math.max(oldTasks.size, newTasks.size, 1);
  const isOverhaul =
    totalTaskChanges / denom > ratioThreshold ||
    totalTaskChanges > absoluteThreshold;

  return {
    milestones: {
      added: milestoneAdded,
      removed: milestoneRemoved,
      modified: milestoneModified,
      totalOld: oldMilestones.size,
      totalNew: newMilestones.size,
    },
    tasks: {
      added: taskAdded,
      removed: taskRemoved,
      modified: taskModified,
      totalOld: oldTasks.size,
      totalNew: newTasks.size,
    },
    totalTaskChanges,
    isOverhaul,
  };
}

/** Cheap helper: count task-nodes in a plan, used by callers that
 *  want a denominator without doing a full diff. */
export function countTasksInPlan(plan: GoalPlan | null | undefined): number {
  return collectTasks(plan).size;
}
