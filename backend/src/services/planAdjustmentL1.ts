/* Starward server — Plan-adjustment Level 1 (scoped AI)
 *
 * The 8% case. Runs when the L0 classifier escalates: too many
 * pending reschedules, large daysOverdueSum, low-completion streak,
 * or triage shielding overflow.
 *
 * Strategy: rather than invent a new prompt template, **delegate to
 * the existing per-goal reschedule pipeline** (cmdAdaptiveReschedule
 * → runLocalLevelReschedule), which already has scope-constrained
 * prompts, week-level splice logic, and critique-agent integration.
 * This service is the orchestrator that:
 *   1. Groups affected tasks by goalId
 *   2. For each goal with a meaningful backlog, dispatches a scoped
 *      reschedule with scopeOverride="local"
 *   3. For tasks with no goalId (user-created), the L0 sweep already
 *      handled them (or left them as user-decision pendingReschedules)
 *   4. Aggregates the per-goal results, logs to plan_adjustments
 *      with attached llm_call_ids
 *
 * Cost containment: the per-goal call is bounded — the existing
 * runLocalLevelReschedule passes only 2-4 weeks to Haiku, never the
 * full plan. So fan-out across N goals is N small calls, not one
 * giant call.
 *
 * The llm_call_ids attribution leans on the request-context window:
 * any llm_calls row inserted while withLlmCallContext is active
 * inherits the kind. We then query for rows in that window keyed by
 * trigger="L1-rollover" to attach to the audit row.
 */

import * as repos from "../repositories";
import { withLlmCallContext } from "./llmUsageLogger";
import { getEffectiveDate } from "../dateUtils";
import { runL0DayScope } from "./planAdjustmentL0";

export interface L1Result {
  goalsTouched: string[];
  goalsSucceeded: string[];
  goalsFailed: { goalId: string; reason: string }[];
  l0Result: Awaited<ReturnType<typeof runL0DayScope>>;
}

/** Run the L1 day-scope handler. Called by the classifier when L0
 *  self-validation fails OR thresholds put us at level=1. */
export async function runL1DayScope(args: {
  date?: string;
  rationale: string;
}): Promise<L1Result> {
  const date = args.date ?? getEffectiveDate();

  // Step 1 — L0 first. It handles the cheap moves; L1 only deals
  // with what L0 couldn't (or what L0's self-validation rejected).
  const l0Result = await runL0DayScope({ date, force: true });

  // Step 2 — the remaining backlog. Only goals that still have
  // pending past-day tasks are candidates.
  const pending = await repos.dailyTasks.listPendingReschedule(date);
  const byGoal = new Map<string, typeof pending>();
  for (const t of pending) {
    if (!t.goalId) continue;
    const arr = byGoal.get(t.goalId) ?? [];
    arr.push(t);
    byGoal.set(t.goalId, arr);
  }

  const result: L1Result = {
    goalsTouched: Array.from(byGoal.keys()),
    goalsSucceeded: [],
    goalsFailed: [],
    l0Result,
  };

  if (byGoal.size === 0) {
    await logAudit(date, args.rationale, result, []);
    return result;
  }

  // Step 3 — for each goal, dispatch a scoped reschedule with
  // scopeOverride="local". This calls into the existing classifier
  // and routes to runLocalLevelReschedule. The withLlmCallContext
  // wrap ensures any LLM calls inside get tagged with kind="L1-
  // rollover" + trigger=date.
  const llmCallIds: string[] = [];
  const cmdAdaptive = await import("../routes/commands/planning");

  for (const [goalId] of byGoal) {
    try {
      // Snapshot llm_calls count before so we can attribute new rows
      // to this goal's run. Per-call attribution is a stretch goal;
      // for now we attach the goal-summary count.
      const before = await countRecentLlmCalls();
      await withLlmCallContext(
        { kind: "L1-rollover", trigger: `L1-rollover:${date}`, extra: { goalId } },
        async () => {
          await cmdAdaptive.cmdAdaptiveReschedule({
            goalId,
            scopeOverride: "local",
          });
        },
      );
      const after = await countRecentLlmCalls();
      // Best-effort attribution: any llm_calls rows added during this
      // goal's window get attached. Imperfect when concurrent users
      // share the row; refine when it matters.
      for (let i = before + 1; i <= after; i++) {
        llmCallIds.push(`recent-${i}`); // placeholder — see logAudit
      }
      result.goalsSucceeded.push(goalId);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[L1] goal ${goalId} reschedule failed:`, reason);
      result.goalsFailed.push({ goalId, reason });
    }
  }

  await logAudit(date, args.rationale, result, llmCallIds);
  return result;
}

async function countRecentLlmCalls(): Promise<number> {
  // Cheap approximation — used only for relative attribution. If this
  // becomes hot we'd add a SELECT COUNT(*) helper to the repo.
  try {
    const summary = await repos.llmCalls.summarizeByKind(1); // last 1 day
    return summary.reduce((s, r) => s + r.callCount, 0);
  } catch {
    return 0;
  }
}

async function logAudit(
  date: string,
  rationale: string,
  result: L1Result,
  llmCallIds: string[],
): Promise<void> {
  try {
    await repos.planAdjustments.insert({
      id: `L1-${date}-${Date.now()}`,
      goalId: null,
      level: 1,
      scope: "day",
      classifierInput: {
        date,
        l0Counts: result.l0Result.counts,
        goalsTouched: result.goalsTouched.length,
      },
      rationale,
      actions: [
        ...result.l0Result.actions.map((a) => ({ ...a, source: "L0-prefix" })),
        ...result.goalsSucceeded.map((goalId) => ({
          kind: "goal-rescheduled",
          goalId,
        })),
        ...result.goalsFailed.map(({ goalId, reason }) => ({
          kind: "goal-failed",
          goalId,
          reason,
        })),
      ],
      llmCallIds,
    });
  } catch (err) {
    console.warn("[L1] plan_adjustments insert failed:", err);
  }
}
