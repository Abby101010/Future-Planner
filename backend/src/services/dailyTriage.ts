/* Lightweight daily triage.
 *
 * Fired (fire-and-forget) after any today-mutation that adds or
 * relocates a `daily_tasks` row: cmdCreateTask, materializePlanTasks,
 * rotateNextTask, and chat-dispatched task intents.
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
 *   5. Emits view:invalidate so the FE re-renders the now-coordinated
 *      list. Caller-perceived latency is unchanged because the entry
 *      points dispatch this via setImmediate after their own response
 *      is returned.
 *
 * What it does NOT do:
 *   - Does NOT run gatekeeper / timeEstimator / scheduler. Those stay
 *     on cmdRefreshDailyPlan (the manual refresh path) where their
 *     full-pipeline cost is justified.
 *   - Does NOT auto-merge overdue tasks or auto-defer over-budget
 *     rows. Audit notes flagged those as separate scoped follow-ups.
 *
 * Failure-tolerant by design: any error logs and returns. The original
 * mutation already succeeded; triage failure must not surface to the
 * user. Same idempotency rules as the rotation path.
 */

import * as repos from "../repositories";
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
  skipped?: "no-tasks" | "all-annotated";
}

export async function lightTriage(date: string): Promise<LightTriageResult> {
  const tasks = await repos.dailyTasks.listForDate(date);
  if (tasks.length === 0) {
    return { date, annotated: 0, reordered: false, skipped: "no-tasks" };
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

  if (annotatedCount > 0 || reordered) {
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
    `[triage] date=${date} annotated=${annotatedCount} reordered=${reordered}`,
  );

  return {
    date,
    annotated: annotatedCount,
    reordered,
    skipped: unannotated.length === 0 && !reordered ? "all-annotated" : undefined,
  };
}
