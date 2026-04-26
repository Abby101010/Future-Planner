/* Starward server — Daily mutation pipeline
 *
 * The single named entry point for fire-and-forget side-effects that
 * MUST run after any daily_task mutation. Today (2026-04-26): light
 * triage → duration estimator → deterministic auto-scheduler. Future:
 * conditional LLM scheduler escalation when the day is too dense for
 * the L0 placement.
 *
 * The contract (ENFORCE THIS — don't bypass):
 *   ANY command handler that creates / updates / deletes / completes /
 *   skips / reschedules a daily_task row MUST dispatch this pipeline
 *   for the affected date(s) before returning. Cross-day mutations
 *   (e.g., reschedule from A → B) pass an array so both days run.
 *
 * Why serial chaining (changed from parallel fire-and-forget on
 * 2026-04-26):
 *   - Triage assigns tier/cognitiveCost — used by auto-scheduler for
 *     placement order.
 *   - Estimator populates estimatedDurationMinutes — used by auto-
 *     scheduler to decide slot widths.
 *   - Auto-scheduler MUST run AFTER both, otherwise it sees stale
 *     null data and skips placements it would otherwise make.
 *
 *   The serial chain runs inside a single setImmediate per date. Total
 *   latency is the same as the previous parallel-fire pattern (the LLM
 *   calls dominate); the difference is correctness, not throughput.
 *
 * Single view:invalidate emit at the end (not per-step) so the FE
 * gets ONE refetch covering all three side-effects rather than three
 * back-to-back refetches that could race.
 *
 * What this DOES NOT include (deliberate, document the why):
 *   - cmdToggleTask's smart task rotation: completion-specific (frees
 *     a slot, picks the next task by tier + bonus rules). Toggle
 *     handler keeps its own rotateNextTask call inline.
 *   - The LLM scheduler agent (agents/scheduler.ts:runScheduler):
 *     deterministic auto-scheduler handles 90% of placements. Reserve
 *     the LLM call for the L1+ classifier when the day genuinely
 *     needs intelligent reshuffling (calendar conflicts, must-do
 *     overflow). Token cost target is $0.50/user/month — a Haiku call
 *     per mutation would burn that 6× over.
 */

import { getCurrentUserId, runWithUserId } from "../middleware/requestContext";
import { timezoneStore } from "../dateUtils";
import { emitViewInvalidate } from "../ws/events";

export type MutationKind =
  | "create"
  | "update"
  | "toggle"
  | "skip"
  | "delete"
  | "reschedule"
  | "materialize";

/**
 * Dispatch the post-mutation pipeline for `dates`. Idempotent in
 * effect: triage debounces via daily_logs.payload.lastTriagedAt;
 * estimator skips already-estimated rows; auto-scheduler skips
 * already-scheduled rows.
 */
export function fireDailyMutationPipeline(
  dates: string | string[],
  kind: MutationKind,
): void {
  const dateList = Array.isArray(dates) ? dates : [dates];
  if (dateList.length === 0) return;

  const userId = getCurrentUserId();
  const tz = timezoneStore.getStore() || "UTC";

  setImmediate(() => {
    runWithUserId(userId, () =>
      timezoneStore.run(tz, async () => {
        let touched = false;
        for (const date of dateList) {
          if (!date) continue;
          const didWork = await runPipelineForDate(date);
          touched = touched || didWork;
        }
        if (touched) {
          try {
            emitViewInvalidate(userId, {
              viewKinds: ["view:tasks", "view:dashboard", "view:calendar"],
            });
          } catch (err) {
            console.warn("[mutation-pipeline] invalidate emit failed:", err);
          }
        }
      }),
    );
  });

  if (process.env.NODE_ENV !== "production") {
    console.debug(
      `[mutation-pipeline] kind=${kind} dates=${dateList.join(",")}`,
    );
  }
}

/**
 * Serial chain for one date. Returns true if any step did meaningful
 * work (so the caller knows whether to emit an invalidation).
 *
 * Each step is wrapped in its own try/catch so a failure in one stage
 * doesn't abort the others. Triage may fail without blocking the
 * estimator; the estimator may fail without blocking the scheduler.
 */
async function runPipelineForDate(date: string): Promise<boolean> {
  let touched = false;

  // 1. Triage — annotate tier/cost, re-sort, demote overflow to bonus.
  //    Suppressed view:invalidate (we emit one at the end of the chain).
  try {
    const { lightTriage } = await import("./dailyTriage");
    const result = await lightTriage(date, { emitInvalidate: false });
    if (result.annotated > 0 || result.reordered || result.demoted > 0) {
      touched = true;
    }
  } catch (err) {
    console.warn("[mutation-pipeline] triage failed:", err);
  }

  // 2. Estimator — populate estimatedDurationMinutes for unestimated rows.
  try {
    const { estimateUnestimatedForDate } = await import("./dailyEstimateDispatch");
    await estimateUnestimatedForDate(date);
    // estimateUnestimatedForDate returns void; assume any LLM call
    // counts as touching state (estimator only fires when there's
    // unestimated rows).
    touched = true;
  } catch (err) {
    console.warn("[mutation-pipeline] estimate failed:", err);
  }

  // 3. Auto-scheduler — place unscheduled rows into the working-hours
  //    envelope. Sees the populated estimates and triage tier from
  //    the previous two steps.
  try {
    const { autoScheduleDay } = await import("./dailyAutoScheduler");
    const result = await autoScheduleDay(date);
    if (result.placed > 0) touched = true;
  } catch (err) {
    console.warn("[mutation-pipeline] auto-schedule failed:", err);
  }

  return touched;
}
