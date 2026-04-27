/* Lightweight daily triage — the coordinator pass that gates display.
 *
 * Fired:
 *   - After any today-mutation (cmdCreateTask, materializePlanTasks,
 *     rotateNextTask, chat-dispatched task intents) — via fire-and-
 *     forget setImmediate.
 *   - From `tasksView` before returning today's task list, debounced
 *     by daily_logs.payload.lastTriagedAt so the LLM annotator only
 *     fires when something has actually changed.
 *
 * What it does:
 *   1. Loads daily_tasks for `date`.
 *   2. If any rows lack priorityAnnotator output (tier / cognitiveCost
 *      / cognitiveLoad), runs the priorityAnnotator agent over JUST
 *      those rows in a single batched call. Skips entirely when every
 *      row is already annotated — saves an LLM round-trip.
 *   3. Writes annotations onto the matching rows (both top-level
 *      columns from migration 0011 and the legacy payload mirror).
 *   4. Deterministically re-sorts the day by (tier, cognitiveCost desc)
 *      and updates order_index on rows that moved.
 *   5. Auto-caps the active list at COGNITIVE_BUDGET.MAX_DAILY_TASKS:
 *      anything beyond the ceiling is demoted to priority="bonus" with
 *      payload.demotedFrom recording the original priority for undo.
 *      must-do tasks are protected from demotion. Plan-attached tasks
 *      ARE demoted when over budget — the plan tree retains them, and
 *      rotation re-promotes as capacity frees.
 *   6. Stamps daily_logs.payload.lastTriagedAt so subsequent reads
 *      can skip the pass.
 *   7. Emits view:invalidate (when called fire-and-forget) so the FE
 *      re-renders the now-coordinated list.
 *
 * What it does NOT do:
 *   - Does NOT run gatekeeper / timeEstimator / scheduler. Those stay
 *     on cmdRefreshDailyPlan where their full-pipeline cost is
 *     justified.
 *   - Does NOT auto-merge overdue tasks. Separate scoped follow-up.
 *   - Does NOT demote must-do tasks. When the cap is unreachable
 *     because too many tasks are flagged must-do, the loop exits
 *     with `demoted < toDemote` AND an `overwhelm` nudge is emitted
 *     (id = `triage-overflow-${date}`) so the failure is visible to
 *     the user instead of silently leaving the active list over-cap.
 *
 * Failure-tolerant by design: any error logs and returns.
 *
 * ⚠ Contract: this is the gate before today's tasks reach the user.
 * Any new path that mutates today's daily_tasks must dispatch
 * fireLightTriage(date). Any view that renders today's tasks should
 * await lightTriage(date, {emitInvalidate: false}) before returning.
 */

import * as repos from "../repositories";
import { COGNITIVE_BUDGET } from "@starward/core";
import { annotatePriorities } from "../agents/priorityAnnotator";
import { getCurrentUserId } from "../middleware/requestContext";
import { emitViewInvalidate } from "../ws/events";
import type { DailyTaskRecord } from "../repositories/dailyTasksRepo";

const TIER_RANK: Record<string, number> = {
  lifetime: 0,
  quarter: 1,
  week: 2,
  day: 3,
};

function tierRank(tier: string | undefined): number {
  return tier && TIER_RANK[tier] !== undefined ? TIER_RANK[tier] : 2.5;
}

/** Pick the best demotion candidate from an over-cap active list.
 *  Input must already be sorted by (tier asc, cognitiveCost desc) per
 *  the lightTriage Step-2 ordering — this walks from the tail.
 *
 *  1st choice: lowest-tier should-do — demoting it doesn't lose a must-do.
 *  Fallback:   lowest-tier must-do — the user has to reconsider their
 *              must-do set; the nudge body softens the suggestion.
 *  Returns null only when activeForCap is empty (shouldn't happen
 *  given the call site, but guard anyway). */
function pickSwapCandidate(activeForCap: DailyTaskRecord[]): DailyTaskRecord | null {
  for (let i = activeForCap.length - 1; i >= 0; i--) {
    const t = activeForCap[i];
    const pl = t.payload as Record<string, unknown>;
    if (pl?.priority === "should-do") return t;
  }
  return activeForCap[activeForCap.length - 1] ?? null;
}

function isAnnotated(t: DailyTaskRecord): boolean {
  // A row is "annotated" when it has a tier set (top-level column from
  // migration 0011 or in the payload mirror). cognitiveCost without a
  // tier shouldn't happen but we guard against it anyway.
  if (typeof t.tier === "string" && t.tier) return true;
  const payloadTier = (t.payload as Record<string, unknown>)?.tier;
  return typeof payloadTier === "string" && Boolean(payloadTier);
}

export interface LightTriageResult {
  date: string;
  annotated: number;
  reordered: boolean;
  demoted: number;
  skipped?: "no-tasks" | "all-annotated";
}

export interface LightTriageOptions {
  /** When false, skip the WS view:invalidate emit. Used when triage is
   *  called from a request handler that's about to return the
   *  coordinated data itself — emitting would just trigger a redundant
   *  refetch. Defaults to true (mutation-path callers). */
  emitInvalidate?: boolean;
}

export async function lightTriage(
  date: string,
  opts: LightTriageOptions = {},
): Promise<LightTriageResult> {
  const emitInvalidate = opts.emitInvalidate !== false;
  const tasks = await repos.dailyTasks.listForDate(date);
  if (tasks.length === 0) {
    return { date, annotated: 0, reordered: false, demoted: 0, skipped: "no-tasks" };
  }

  const unannotated = tasks.filter((t) => !isAnnotated(t));
  let annotatedCount = 0;

  // Step 1 — annotate any rows missing tier/cost/load. Single LLM call.
  if (unannotated.length > 0) {
    let userSegment: string | null = null;
    try {
      const u = await repos.users.get();
      userSegment = u?.settings?.userSegment ?? null;
    } catch {
      // best-effort; segment defaults to "general" inside the agent
    }

    const annotatorInput = unannotated.map((t) => {
      const pl = t.payload as Record<string, unknown>;
      return {
        id: t.id,
        title: t.title,
        description: (pl.description as string | undefined) ?? "",
        category: (pl.category as string | undefined) ?? undefined,
        goalId: t.goalId ?? null,
        // goalTitle is on the flattened DailyTask but not the record;
        // resolved by the annotator from goalId via internal lookup if
        // needed — we just pass goalId here.
      };
    });

    let annotations: Awaited<ReturnType<typeof annotatePriorities>>["annotations"] = {};
    try {
      const result = await annotatePriorities({ tasks: annotatorInput, userSegment });
      annotations = result.annotations;
    } catch (err) {
      console.warn("[triage] priorityAnnotator failed:", err);
      // Continue: we can still re-sort what's already annotated.
    }

    for (const t of unannotated) {
      const a = annotations[t.id];
      if (!a) continue;
      try {
        await repos.dailyTasks.update(t.id, {
          tier: a.tier,
          cognitiveCost: a.cognitiveCost,
          cognitiveLoad: a.cognitiveLoad,
          payload: {
            tier: a.tier,
            cognitiveCost: a.cognitiveCost,
            cognitiveLoad: a.cognitiveLoad,
            tierRationale: a.rationale,
          },
        });
        annotatedCount++;
      } catch (err) {
        console.warn(`[triage] failed to write annotation for ${t.id}:`, err);
      }
    }
  }

  // Step 2 — re-sort by (tier, cognitiveCost desc). Refresh the list
  // since payload changed for the rows we just annotated.
  const refreshed = annotatedCount > 0 ? await repos.dailyTasks.listForDate(date) : tasks;
  const sorted = [...refreshed].sort((a, b) => {
    const aTier = tierRank(
      (a.tier as string | undefined) ??
        ((a.payload as Record<string, unknown>)?.tier as string | undefined),
    );
    const bTier = tierRank(
      (b.tier as string | undefined) ??
        ((b.payload as Record<string, unknown>)?.tier as string | undefined),
    );
    if (aTier !== bTier) return aTier - bTier;
    const aCost = (a.cognitiveCost as number | null) ?? 0;
    const bCost = (b.cognitiveCost as number | null) ?? 0;
    return bCost - aCost;
  });

  // Step 3 — write back order_index when it changed. Skip rows that
  // already match their new position to keep the SQL load minimal.
  let reordered = false;
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    if (t.orderIndex !== i) {
      try {
        await repos.dailyTasks.update(t.id, { orderIndex: i });
        reordered = true;
      } catch (err) {
        console.warn(`[triage] failed to reorder ${t.id}:`, err);
      }
    }
  }

  // Step 4 — auto-cap the active list. Active = not completed, not
  // skipped, not already-bonus. Anything beyond `cap` (after sorted)
  // gets demoted to bonus tier. must-do tasks are protected.
  // Plan-attached tasks ARE demoted — the plan tree retains them;
  // rotation re-promotes as the user completes.
  //
  // Cap precedence: the user's monthly busyness signal
  // (monthly_contexts.maxDailyTasks, set by FE MonthlyIntensityCard
  // via the analyze-monthly-context handler) wins over the default
  // ceiling. This is what makes "intense month" actually trim the
  // active list to 1, not just shape the LLM prompt. Falls back to
  // the default ceiling on any read error or absent context. Logged
  // with `cap` + `source` so the cap origin is observable in logs.
  const monthKey = date.slice(0, 7);
  let monthly: Awaited<ReturnType<typeof repos.monthlyContext.get>> = null;
  try {
    monthly = await repos.monthlyContext.get(monthKey);
  } catch (err) {
    console.warn("[triage] monthly load failed:", err);
  }
  const cap = monthly?.maxDailyTasks ?? COGNITIVE_BUDGET.MAX_DAILY_TASKS;
  const capSource = monthly ? "monthly" : "default";

  let demoted = 0;
  let undemoted = 0;
  const activeForCap = sorted.filter((t) => {
    if (t.completed) return false;
    const pl = t.payload as Record<string, unknown>;
    if (pl.skipped) return false;
    if (pl.priority === "bonus" || pl.isBonus) return false;
    return true;
  });

  if (activeForCap.length > cap) {
    const isProtected = (t: DailyTaskRecord): boolean => {
      const pl = t.payload as Record<string, unknown>;
      // must-do priority is protected from auto-demotion (existing rule).
      if (pl.priority === "must-do") return true;
      // userPromoted: true is set by cmdGenerateBonusTask when the user
      // explicitly clicks the "Bonus task" button to pull a task from
      // the bonus tier back into the active list. Triage must NOT
      // re-demote it on the next pass — otherwise the button would
      // immediately self-undo and the user couldn't ever exceed the
      // cap. This is the deliberate user-override path.
      if (pl.userPromoted) return true;
      return false;
    };
    // The TAIL (lowest tier + lowest cost) of `activeForCap` is the
    // demotion candidate set. We've already sorted by (tier asc, cost
    // desc) — so just walk from the bottom up, skipping protected.
    let toDemote = activeForCap.length - cap;
    for (let i = activeForCap.length - 1; i >= 0 && toDemote > 0; i--) {
      const t = activeForCap[i];
      if (isProtected(t)) continue;
      try {
        await repos.dailyTasks.update(t.id, {
          payload: {
            priority: "bonus",
            isBonus: true,
            demotedFrom:
              (t.payload as Record<string, unknown>)?.priority ?? "should-do",
            demotedAt: new Date().toISOString(),
          },
        });
        demoted++;
        toDemote--;
      } catch (err) {
        console.warn(`[triage] demote ${t.id} failed:`, err);
      }
    }
    // If the loop exhausted candidates without reaching the cap, the
    // remaining tail is all must-do — protected from demotion. Surface
    // the overflow as an `overwhelm` nudge so the user can see the
    // active list is still over-cap and decide what to do (lower a
    // must-do, reschedule, or accept the load). Without this, the
    // function returned demoted=0 and the caller had no signal that
    // the cap was exceeded.
    undemoted = toDemote;
    if (undemoted > 0) {
      console.warn(
        `[triage] could not demote ${undemoted} task(s); all remaining candidates are must-do (cap=${cap}, active=${activeForCap.length})`,
      );
      // Compute a swap candidate so the nudge can suggest a SPECIFIC
      // task to demote, not just "you're over cap." Mirrors the
      // swapSuggestion shape returned by cmdAcceptTaskProposal
      // (planning.ts:1473) and cmdRescheduleTask (tasks.ts:898) so
      // any FE swap-card component can render all three uniformly.
      //
      // activeForCap is already sorted by (tier asc, cost desc), so
      // walking from the tail finds the lowest-priority candidate:
      //   1st choice — last should-do (demoting it doesn't lose a must-do)
      //   fallback   — last must-do (the user has to reconsider their
      //                must-do set; nudge body softens the ask)
      const swapCandidate = pickSwapCandidate(activeForCap);
      const swapPriority = swapCandidate
        ? ((swapCandidate.payload as Record<string, unknown>)?.priority as string | undefined) ?? "should-do"
        : null;
      const suggestionText = swapCandidate
        ? swapPriority === "must-do"
          ? `Every active task is must-do — to fit, you'd need to demote "${swapCandidate.title}" or reschedule one.`
          : `Move "${swapCandidate.title}" to bonus to make room?`
        : "Lower a priority, reschedule, or accept the heavier day.";
      try {
        await repos.nudges.insert({
          id: `triage-overflow-${date}`,
          kind: "overwhelm",
          title: "Too many must-do tasks today",
          body: `${undemoted} task${undemoted === 1 ? " is" : "s are"} above today's cap of ${cap} but flagged must-do. ${suggestionText}`,
          priority: 80,
          context: `triage-overflow:${date}`,
          extra: {
            date,
            cap,
            activeCount: activeForCap.length,
            undemoted,
            swapCandidate: swapCandidate
              ? {
                  taskId: swapCandidate.id,
                  title: swapCandidate.title,
                  currentPriority:
                    ((swapCandidate.payload as Record<string, unknown>)?.priority as string | undefined) ?? "should-do",
                  cognitiveCost: swapCandidate.cognitiveCost ?? null,
                  tier: swapCandidate.tier ?? null,
                }
              : null,
          },
        });
      } catch (err) {
        console.warn("[triage] overflow nudge insert failed:", err);
      }
    } else {
      // Cap was reachable this pass — clear any stale overflow nudge
      // from a prior triage so it doesn't linger after the user fixed
      // their priorities.
      try {
        await repos.nudges.dismissByContext(`triage-overflow:${date}`);
      } catch {
        /* best-effort */
      }
    }
  }

  // Stamp the daily log so subsequent reads can debounce. Best-effort
  // — failure here just means the next read may run another pass.
  try {
    await repos.dailyLogs.ensureExists(date);
    await repos.dailyLogs.patchPayload(date, {
      lastTriagedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn("[triage] lastTriagedAt stamp failed:", err);
  }

  if (emitInvalidate && (annotatedCount > 0 || reordered || demoted > 0)) {
    try {
      const userId = getCurrentUserId();
      emitViewInvalidate(userId, {
        viewKinds: ["view:tasks", "view:dashboard"],
      });
    } catch (err) {
      console.warn("[triage] view-invalidate emit failed:", err);
    }
  }

  console.log(
    `[triage] date=${date} annotated=${annotatedCount} reordered=${reordered} demoted=${demoted} undemoted=${undemoted} cap=${cap} source=${capSource}`,
  );

  return {
    date,
    annotated: annotatedCount,
    reordered,
    demoted,
    skipped:
      unannotated.length === 0 && !reordered && demoted === 0
        ? "all-annotated"
        : undefined,
  };
}
