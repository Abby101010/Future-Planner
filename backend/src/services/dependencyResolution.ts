/* Dependency resolution — pure algorithm, zero AI.
 *
 * Given a target date's scheduled tasks + the set of completed task
 * IDs + the pool of overdue prerequisites, decide which tasks are
 * actually doable on the target date and which need to swap places
 * with their unfinished prerequisites.
 *
 * Per-goal scoping: this function operates on a single goal's tasks.
 * Cross-goal dependencies are not modeled (the AI prompt at
 * backend/core/src/ai/prompts/goalPlan.ts forbids them; the
 * normalizer rejects any that slip through). The L0 rollover
 * orchestrator (planAdjustmentL0.ts) calls this per goal then merges
 * the results into a single tomorrow-list.
 *
 * Cycle detection: a cycle (A→B→A) is treated as an AI bug — we log
 * a warning and break the cycle by treating the "first" task in
 * traversal order as runnable. Better to ship a slightly-wrong plan
 * than to lock the goal forever. */

import type { DailyTaskRecord } from "../repositories/dailyTasksRepo";

export interface ResolveResult {
  /** Tasks scheduled for the target date whose deps are satisfied. */
  keep: DailyTaskRecord[];
  /** Pairs where `dependent` was scheduled for the target but its
   *  `prereq` is incomplete and overdue — caller should pull the
   *  prereq forward and push the dependent out. */
  swap: Array<{ dependent: DailyTaskRecord; prereq: DailyTaskRecord }>;
  /** Tasks scheduled for the target whose deps include an incomplete
   *  task that is NOT in the overdue pool (e.g. it's scheduled
   *  further in the future). Caller should push these out to a
   *  future date past the prereq's eventual completion. */
  pushOut: DailyTaskRecord[];
  /** Cycles found during traversal — informational, for logging. */
  cyclesDetected: number;
}

/** Resolve dependencies for a single goal on a single target date.
 *
 *  @param scheduled  Tasks scheduled for the target date (one goal).
 *  @param completed  Set of task IDs the user has completed (any goal,
 *                    but only same-goal IDs will appear in deps).
 *  @param pendingPrereqs  Overdue tasks from the same goal that
 *                    could be pulled in to unblock dependents.
 */
export function resolveDependenciesForDay(
  scheduled: DailyTaskRecord[],
  completed: Set<string>,
  pendingPrereqs: DailyTaskRecord[],
): ResolveResult {
  const keep: DailyTaskRecord[] = [];
  const swap: Array<{ dependent: DailyTaskRecord; prereq: DailyTaskRecord }> = [];
  const pushOut: DailyTaskRecord[] = [];
  let cyclesDetected = 0;

  // Build lookup maps. The `dependsOn` arrays from the BE point at
  // plan_node_id values (since the AI's "date:idx" refs were
  // normalized to plan-tree task IDs at generation, then materialized
  // onto daily_tasks). The plan_node_id is what's recorded in
  // `task.dependsOn`.
  const prereqById = new Map<string, DailyTaskRecord>();
  for (const p of pendingPrereqs) {
    if (p.planNodeId) prereqById.set(p.planNodeId, p);
    prereqById.set(p.id, p); // also accept daily_tasks.id refs
  }

  for (const t of scheduled) {
    const deps = t.dependsOn ?? [];
    if (deps.length === 0) {
      keep.push(t);
      continue;
    }

    // Cycle detection: walk the dep chain breadth-first; if we see
    // a task we've already visited, it's a cycle. Bail and treat
    // as runnable (ship the plan even if AI emitted bad refs).
    const visited = new Set<string>();
    let hasCycle = false;
    let firstUnsatisfied: DailyTaskRecord | null = null;
    let firstUnsatisfiedScheduledLater = false;

    const queue = [...deps];
    while (queue.length > 0) {
      const depId = queue.shift()!;
      if (visited.has(depId)) {
        hasCycle = true;
        break;
      }
      visited.add(depId);

      // Already done? satisfied.
      if (completed.has(depId)) continue;

      // In our overdue pool? candidate to swap.
      const prereq = prereqById.get(depId);
      if (prereq) {
        if (!firstUnsatisfied) firstUnsatisfied = prereq;
        // Don't traverse further into this dep's own deps — the
        // pull-prereq step will handle transitivity on its next
        // L0 sweep.
        continue;
      }

      // Not done, not in overdue pool. Either scheduled for a
      // future date or doesn't exist (deleted). Either way, the
      // dependent task can't run today.
      firstUnsatisfiedScheduledLater = true;
    }

    if (hasCycle) {
      cyclesDetected++;
      console.warn(
        `[dependencyResolution] cycle detected for task ${t.id} ` +
          `(deps: ${JSON.stringify(deps)}). Treating as runnable.`,
      );
      keep.push(t);
      continue;
    }

    if (firstUnsatisfied) {
      // Swap: pull this prereq forward, push `t` out.
      swap.push({ dependent: t, prereq: firstUnsatisfied });
      continue;
    }

    if (firstUnsatisfiedScheduledLater) {
      // Prereq exists but isn't overdue — it's scheduled in the
      // future. Push `t` past it.
      pushOut.push(t);
      continue;
    }

    // All deps satisfied (completed).
    keep.push(t);
  }

  return { keep, swap, pushOut, cyclesDetected };
}
