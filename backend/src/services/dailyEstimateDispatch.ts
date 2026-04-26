/* dailyEstimateDispatch — fire-and-forget wrapper around the duration
 * estimator (cmdEstimateTaskDurations).
 *
 * Mirrors dailyTriageDispatch.ts. Mutators that insert `daily_tasks`
 * rows (planMaterialization, cmdCreateTask, etc.) call
 * `fireEstimateDurations(date)` after their own DB write succeeds. The
 * dispatch:
 *   1. Loads daily_tasks for `date`.
 *   2. Filters to rows where `estimatedDurationMinutes` is null.
 *   3. If any unestimated rows exist, runs cmdEstimateTaskDurations on
 *      just those IDs in a single batched LLM call.
 *
 * Skips entirely when every row is already estimated — no LLM cost.
 *
 * Why: the time dimension of the cognitive budget (MAX_DEEP_MINUTES)
 * is meaningless when tasks have no estimates. Previously the only
 * way to populate estimates was the manual "Estimate all" button on
 * the Tasks page, leaving every newly-materialized day with a "0h 0m
 * planned" header until the user clicked. Auto-firing here makes the
 * time budget actually load-bearing without changing user behavior.
 *
 * Failure-tolerant: errors log and swallow so the original mutation's
 * response is never affected. The estimates land ~1-2s later via the
 * estimator's own view:invalidate emit (when present) or the next
 * view fetch.
 */

import { getCurrentUserId, runWithUserId } from "../middleware/requestContext";
import { timezoneStore } from "../dateUtils";

/**
 * Awaitable inner work — populate estimatedDurationMinutes for any
 * unestimated tasks on `date`. Used by `fireDailyMutationPipeline`
 * to chain auto-scheduling AFTER estimates land. Safe to call from
 * a context that already has userId + timezone in AsyncLocalStorage.
 */
export async function estimateUnestimatedForDate(date: string): Promise<void> {
  const repos = await import("../repositories");
  const tasks = await repos.dailyTasks.listForDate(date);
  const unestimated = tasks
    .filter((t) => t.estimatedDurationMinutes == null && !t.completed)
    .map((t) => t.id);
  if (unestimated.length === 0) return;

  const { cmdEstimateTaskDurations } = await import(
    "../routes/commands/timeBlocks"
  );
  const result = await cmdEstimateTaskDurations({ taskIds: unestimated });
  console.log(
    `[estimate] date=${date} requested=${unestimated.length} updated=${result.updated}`,
  );
}

/**
 * Fire-and-forget wrapper. Kept for back-compat with planMaterialization
 * and any other call site that wants to dispatch without waiting. New
 * code should prefer the unified `fireDailyMutationPipeline` so the
 * full triage → estimate → auto-schedule chain runs in order.
 */
export function fireEstimateDurations(date: string): void {
  const userId = getCurrentUserId();
  const tz = timezoneStore.getStore() || "UTC";
  setImmediate(() => {
    runWithUserId(userId, () =>
      timezoneStore.run(tz, async () => {
        try {
          await estimateUnestimatedForDate(date);
        } catch (err) {
          console.warn("[estimate] dispatch failed:", err);
        }
      }),
    );
  });
}
