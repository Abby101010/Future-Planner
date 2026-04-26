/* Starward server — Plan-adjustment Level 0 (zero AI)
 *
 * The named entry point for the cheap, deterministic 90% of plan
 * adjustments. Composes existing pure-algo services rather than
 * inventing new logic — markStaleAsSkipped, listPendingReschedule,
 * goalPlan.moveTaskToDate, dailyTasks.update, gatekeeper.runBudgetCheck.
 *
 * Two scopes today:
 *   - scope="day": sweep stale tasks; auto-move clearly-safe overdue
 *     tasks to their suggested date when the target has capacity;
 *     leave the rest as user-decision pendingReschedules cards.
 *   - scope="task": reschedule one specified task to one specified
 *     date with a budget gate. Used by manual flows.
 *
 * Self-validation: after attempting a move, runs runBudgetCheck on
 * the target day. If the move would push the day over its cap, the
 * move is skipped and the result includes `escalated: true` so the
 * caller can re-run via classifyAdjustment with a forced floor of
 * L1. L0 fails loudly, never silently.
 *
 * Side-effects logged to plan_adjustments via insert(). Zero AI calls
 * means an empty `llmCallIds` array on the audit row.
 */

import * as repos from "../repositories";
import { runBudgetCheck } from "../agents/gatekeeper";
import { getEffectiveDate } from "../dateUtils";
import type { AdjustmentScope } from "@starward/core";

export interface L0Action {
  kind: "swept-aged-out" | "moved-task" | "left-as-pending" | "validation-failed";
  taskId?: string;
  fromDate?: string;
  toDate?: string;
  reason?: string;
}

export interface L0Result {
  scope: AdjustmentScope;
  actions: L0Action[];
  /** True when one or more attempted moves failed validation,
   *  meaning the caller should re-run at L1. */
  escalated: boolean;
  /** Counts of items the L0 pass touched, for fast rationale-building. */
  counts: {
    sweptAgedOut: number;
    movedTasks: number;
    leftAsPending: number;
    validationFailures: number;
  };
}

const SAFE_AUTO_MOVE_DAYS_OVERDUE_MAX = 3;
const SAFE_AUTO_MOVE_TARGET_LOOKAHEAD_DAYS = 7;

/** Run the L0 day-scope sweep for the current user.
 *
 *  Idempotent: relies on `daily_logs.payload.lastRolloverAt` debounce,
 *  same field the lazy resolver-fetch sweep uses.
 */
export async function runL0DayScope(args: {
  /** When omitted, uses getEffectiveDate(). */
  date?: string;
  /** When true, skip the lastRolloverAt debounce check. Used by
   *  cron and tests; user-driven calls (resolver-fetch) leave it
   *  default-false to avoid back-to-back sweeps. */
  force?: boolean;
}): Promise<L0Result> {
  const date = args.date ?? getEffectiveDate();
  const result: L0Result = {
    scope: "day",
    actions: [],
    escalated: false,
    counts: {
      sweptAgedOut: 0,
      movedTasks: 0,
      leftAsPending: 0,
      validationFailures: 0,
    },
  };

  // Step 1 — debounce. Skip when the lazy sweep already ran in the
  // last 30 min, unless force=true (cron / tests).
  if (!args.force) {
    try {
      const log = await repos.dailyLogs.get(date);
      const last = log
        ? ((log.payload as Record<string, unknown>)?.lastRolloverAt as string | undefined)
        : undefined;
      if (last && Date.now() - new Date(last).getTime() < 30 * 60_000) {
        return result; // recent sweep — nothing to do
      }
    } catch {
      /* best-effort */
    }
  }

  // Step 2 — mark tasks >90 days old as skipped (aged out). Already
  // honors the "no silent drops" contract: each row keeps a
  // payload.skippedReason so it's discoverable in history.
  try {
    const sweptCount = await repos.dailyTasks.markStaleAsSkipped(date);
    result.counts.sweptAgedOut = sweptCount;
    if (sweptCount > 0) {
      result.actions.push({ kind: "swept-aged-out", reason: `${sweptCount} task(s) >90 days marked aged-out` });
    }
  } catch (err) {
    console.warn("[L0] markStaleAsSkipped failed:", err);
  }

  // Step 3 — read pending reschedules. Only auto-move ones that are
  // small (≤3 days overdue) AND have a clear next slot. Larger gaps
  // become user-decision pendingReschedules cards, not L0 moves.
  let pending: Awaited<ReturnType<typeof repos.dailyTasks.listPendingReschedule>>;
  try {
    pending = await repos.dailyTasks.listPendingReschedule(date);
  } catch (err) {
    console.warn("[L0] listPendingReschedule failed:", err);
    pending = [];
  }

  const todayMs = new Date(date + "T00:00:00").getTime();
  const candidates = pending.filter((t) => {
    const overdue = Math.floor((todayMs - new Date(t.date + "T00:00:00").getTime()) / 86_400_000);
    return overdue > 0 && overdue <= SAFE_AUTO_MOVE_DAYS_OVERDUE_MAX;
  });

  for (const task of candidates) {
    // Suggested target: the lightest of the next N upcoming days.
    // Pick the first day with capacity; fall back to leaving as pending.
    const target = await pickLightestUpcomingDay(date, SAFE_AUTO_MOVE_TARGET_LOOKAHEAD_DAYS);
    if (!target) {
      result.counts.leftAsPending++;
      result.actions.push({ kind: "left-as-pending", taskId: task.id, reason: "no upcoming day with capacity" });
      continue;
    }

    const targetTasks = await repos.dailyTasks.listForDate(target);
    const taskWeight = (task.payload.cognitiveWeight as number) ?? 3;
    const budget = runBudgetCheck(
      targetTasks
        .filter((t) => !t.completed && !((t.payload as Record<string, unknown>).skipped))
        .map((t) => ({
          cognitiveWeight: (t.payload as Record<string, unknown>).cognitiveWeight as number | undefined,
          durationMinutes: (t.payload as Record<string, unknown>).durationMinutes as number | undefined,
        })),
      taskWeight,
    );

    if (budget.overBudget) {
      // Self-validation failure → don't move, escalate signal upward.
      result.counts.validationFailures++;
      result.escalated = true;
      result.actions.push({
        kind: "validation-failed",
        taskId: task.id,
        toDate: target,
        reason: `budget gate failed (projected weight ${budget.totalWeight} > ${budget.maxWeight})`,
      });
      continue;
    }

    // Move the task: update the daily_tasks row date, plus sync the
    // plan tree if linked (mirrors cmdRescheduleTask:920-940).
    try {
      await repos.dailyTasks.update(task.id, {
        date: target,
        orderIndex: targetTasks.length,
        payload: { rescheduledFrom: task.date, rescheduledByL0At: new Date().toISOString() },
      });
      await repos.dailyLogs.ensureExists(target);
      if (task.planNodeId && task.goalId) {
        try {
          await repos.goalPlan.moveTaskToDate(task.planNodeId, task.goalId, target);
        } catch (err) {
          console.warn(`[L0] plan node sync failed for ${task.id}:`, err);
        }
      }
      result.counts.movedTasks++;
      result.actions.push({ kind: "moved-task", taskId: task.id, fromDate: task.date, toDate: target });
    } catch (err) {
      console.warn(`[L0] move task ${task.id} failed:`, err);
    }
  }

  // Step 4 — stamp lastRolloverAt for the debounce window.
  try {
    await repos.dailyLogs.ensureExists(date);
    await repos.dailyLogs.patchPayload(date, { lastRolloverAt: new Date().toISOString() });
  } catch (err) {
    console.warn("[L0] lastRolloverAt stamp failed:", err);
  }

  // Step 5 — log to plan_adjustments. Skip writing a row when nothing
  // happened to keep the audit log signal-rich.
  const touched =
    result.counts.sweptAgedOut +
    result.counts.movedTasks +
    result.counts.leftAsPending +
    result.counts.validationFailures;
  if (touched > 0) {
    try {
      await repos.planAdjustments.insert({
        id: `L0-${date}-${Date.now()}`,
        goalId: null,
        level: 0,
        scope: "day",
        classifierInput: { date, candidatesConsidered: candidates.length },
        rationale: rationaleFor(result),
        actions: result.actions as unknown as Record<string, unknown>[],
      });
    } catch (err) {
      console.warn("[L0] plan_adjustments insert failed:", err);
    }
  }

  return result;
}

/** Pick the first day in the next N days that has fewer active tasks
 *  than COGNITIVE_BUDGET.MAX_DAILY_TASKS. Returns null if none. */
async function pickLightestUpcomingDay(
  fromDate: string,
  lookaheadDays: number,
): Promise<string | null> {
  const start = new Date(fromDate + "T00:00:00");
  for (let i = 1; i <= lookaheadDays; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split("T")[0];
    const tasks = await repos.dailyTasks.listForDate(dateStr);
    const active = tasks.filter((t) => !t.completed && !((t.payload as Record<string, unknown>).skipped));
    // Use a lower bar than the strict cap so we leave headroom for new
    // user-added work — moving INTO a day that's already at the cap
    // would just kick the can.
    if (active.length < 4) return dateStr;
  }
  return null;
}

function rationaleFor(r: L0Result): string {
  const parts: string[] = [];
  if (r.counts.sweptAgedOut > 0) parts.push(`swept ${r.counts.sweptAgedOut} aged-out`);
  if (r.counts.movedTasks > 0) parts.push(`moved ${r.counts.movedTasks} task(s)`);
  if (r.counts.leftAsPending > 0) parts.push(`left ${r.counts.leftAsPending} as pending`);
  if (r.counts.validationFailures > 0) parts.push(`${r.counts.validationFailures} validation failure(s) → escalate`);
  return parts.length > 0 ? parts.join("; ") : "no-op";
}
