/* ──────────────────────────────────────────────────────────
   NorthStar — Scheduler Sub-Agent

   Builds a 3-tier schedule from calendar events, goal blocks,
   and task slots, then calls Haiku for conflict detection and
   reshuffle proposals.
   ────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import { getClient } from "../ai/client";
import { emitAgentProgress } from "../ws";
import { getCurrentUserId } from "../middleware/requestContext";
import { getModelForTask } from "@northstar/core";
import type {
  TaskStateInput,
  GatekeeperResult,
  TimeEstimatorResult,
  SchedulerResult,
  ScheduleBlock,
  TierEnforcement,
  CalendarConflict,
  ReshuffleAction,
  OpportunityCost,
  PriorityAnnotatorResult,
  PriorityAnnotation,
  TriagedTask,
} from "@northstar/core";
import { SCHEDULER_SYSTEM } from "./prompts/scheduler";
import * as repos from "../repositories";

// ── Helpers ────────────────────────────────────────────────

/** Build Tier 1 calendar blocks from scheduled tasks (those with a time slot). */
function buildCalendarBlocks(input: TaskStateInput): ScheduleBlock[] {
  return input.scheduledTasks
    .filter((t) => t.scheduledTime)
    .map((t) => ({
      startTime: t.scheduledTime ?? "",
      endTime: t.scheduledEndTime ?? "",
      label: t.title,
      tier: "calendar" as const,
      durationMinutes: t.durationMinutes > 0 ? t.durationMinutes : 60,
    }));
}

/** Build Tier 2 goal blocks from filtered tasks (deep-work windows). */
function buildGoalBlocks(
  gatekeeper: GatekeeperResult,
  timeEstimator: TimeEstimatorResult,
): ScheduleBlock[] {
  // Group filtered tasks by goalId to create goal-level blocks
  const goalGroups = new Map<string, { goalId: string; goalTitle: string; totalMinutes: number }>();

  for (const task of gatekeeper.filteredTasks) {
    if (!task.goalId) continue;
    const estimate = timeEstimator.estimates[task.id];
    const minutes = estimate
      ? estimate.adjustedMinutes + estimate.bufferMinutes
      : task.durationMinutes;

    const existing = goalGroups.get(task.goalId);
    if (existing) {
      existing.totalMinutes += minutes;
    } else {
      goalGroups.set(task.goalId, {
        goalId: task.goalId,
        goalTitle: task.goalTitle ?? "Goal",
        totalMinutes: minutes,
      });
    }
  }

  // Convert to schedule blocks (no specific times — the AI will help place them)
  return Array.from(goalGroups.values()).map((g) => ({
    startTime: "",
    endTime: "",
    label: `Deep work: ${g.goalTitle}`,
    tier: "goal" as const,
    durationMinutes: g.totalMinutes,
    goalId: g.goalId,
  }));
}

/** Build Tier 3 task slots for non-goal tasks. */
function buildTaskSlots(
  gatekeeper: GatekeeperResult,
  timeEstimator: TimeEstimatorResult,
): ScheduleBlock[] {
  return gatekeeper.filteredTasks
    .filter((t) => !t.goalId)
    .map((t) => {
      const estimate = timeEstimator.estimates[t.id];
      const minutes = estimate
        ? estimate.adjustedMinutes + estimate.bufferMinutes
        : t.durationMinutes;
      return {
        startTime: "",
        endTime: "",
        label: t.title,
        tier: "task" as const,
        durationMinutes: minutes,
      };
    });
}

/** Parse AI JSON response safely. */
function parseAiResponse(text: string): {
  conflicts: CalendarConflict[];
  reshuffleProposal: ReshuffleAction[] | null;
  opportunityCost: OpportunityCost | null;
} {
  try {
    const cleaned = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);

    const conflicts: CalendarConflict[] = Array.isArray(parsed.conflicts)
      ? parsed.conflicts.map((c: Record<string, unknown>) => ({
          taskId: String(c.taskId ?? ""),
          eventTitle: String(c.eventTitle ?? ""),
          overlapMinutes: typeof c.overlapMinutes === "number" ? c.overlapMinutes : 0,
          resolution: (c.resolution === "defer" || c.resolution === "shorten" || c.resolution === "move")
            ? c.resolution
            : "move" as const,
        }))
      : [];

    const reshuffleProposal: ReshuffleAction[] | null = Array.isArray(parsed.reshuffleProposal)
      ? parsed.reshuffleProposal.map((r: Record<string, unknown>) => ({
          taskId: String(r.taskId ?? ""),
          action: (r.action === "keep" || r.action === "defer" || r.action === "swap" || r.action === "drop")
            ? r.action
            : "keep" as const,
          reason: String(r.reason ?? ""),
        }))
      : null;

    let opportunityCost: OpportunityCost | null = null;
    if (parsed.opportunityCost && typeof parsed.opportunityCost === "object") {
      const oc = parsed.opportunityCost as Record<string, unknown>;
      opportunityCost = {
        weeklyHoursRequired: typeof oc.weeklyHoursRequired === "number" ? oc.weeklyHoursRequired : 0,
        affectedGoals: Array.isArray(oc.affectedGoals)
          ? (oc.affectedGoals as Array<Record<string, unknown>>).map((g) => ({
              goalId: String(g.goalId ?? ""),
              title: String(g.title ?? ""),
              currentWeeklyHours: typeof g.currentWeeklyHours === "number" ? g.currentWeeklyHours : 0,
              projectedWeeklyHours: typeof g.projectedWeeklyHours === "number" ? g.projectedWeeklyHours : 0,
              reductionPercent: typeof g.reductionPercent === "number" ? g.reductionPercent : 0,
            }))
          : [],
        deepWorkImpact: {
          currentDailyMinutes:
            typeof (oc.deepWorkImpact as Record<string, unknown>)?.currentDailyMinutes === "number"
              ? (oc.deepWorkImpact as Record<string, unknown>).currentDailyMinutes as number
              : 0,
          projectedDailyMinutes:
            typeof (oc.deepWorkImpact as Record<string, unknown>)?.projectedDailyMinutes === "number"
              ? (oc.deepWorkImpact as Record<string, unknown>).projectedDailyMinutes as number
              : 0,
        },
        warning: typeof oc.warning === "string" ? oc.warning : null,
      };
    }

    return { conflicts, reshuffleProposal, opportunityCost };
  } catch {
    console.error("[scheduler] Failed to parse AI response, returning empty conflicts");
    return { conflicts: [], reshuffleProposal: null, opportunityCost: null };
  }
}

// ── Phase B: cognitive-budget enforcement ─────────────────

const TIER_PRIORITY: Record<string, number> = {
  lifetime: 0,
  quarter: 1,
  week: 2,
  day: 3,
};

const DEFAULT_DAILY_COGNITIVE_BUDGET = 22;

async function resolveDailyCognitiveBudget(): Promise<number> {
  try {
    const user = await repos.users.get();
    const n = user?.settings?.dailyCognitiveBudget;
    return typeof n === "number" && n > 0 ? n : DEFAULT_DAILY_COGNITIVE_BUDGET;
  } catch {
    return DEFAULT_DAILY_COGNITIVE_BUDGET;
  }
}

/** Sum cognitiveCost across annotated tasks. Tasks without annotations
 *  are skipped (their cost is unknown; pre-Phase-B rows will not contribute). */
function sumCognitiveCost(
  tasks: TriagedTask[],
  annotations: Record<string, PriorityAnnotation>,
): number {
  let total = 0;
  for (const t of tasks) {
    const a = annotations[t.id];
    if (a) total += a.cognitiveCost;
  }
  return total;
}

/** Order tasks by tier (lifetime first) and — within a tier — by descending
 *  cognitiveCost so the heaviest lifetime work anchors the day. Unannotated
 *  tasks keep their original ordering by sliding to the front with a stable
 *  synthetic "unknown" tier that outranks "day" (we don't know if it's low
 *  value, so don't drop it first). */
function orderByTier(
  tasks: TriagedTask[],
  annotations: Record<string, PriorityAnnotation>,
): TriagedTask[] {
  return tasks.slice().sort((a, b) => {
    const aa = annotations[a.id];
    const ab = annotations[b.id];
    const aTier = aa ? TIER_PRIORITY[aa.tier] ?? 3 : 2.5;
    const bTier = ab ? TIER_PRIORITY[ab.tier] ?? 3 : 2.5;
    if (aTier !== bTier) return aTier - bTier;
    const aCost = aa?.cognitiveCost ?? 0;
    const bCost = ab?.cognitiveCost ?? 0;
    return bCost - aCost;
  });
}

/** If total cognitiveCost exceeds the user's daily budget, defer the
 *  lowest-tier tasks (starting from "day", then "week", then "quarter")
 *  until the sum is within budget. Returns the trimmed list and the ids
 *  that were deferred. */
function enforceCognitiveBudget(
  tasks: TriagedTask[],
  annotations: Record<string, PriorityAnnotation>,
  budget: number,
): { kept: TriagedTask[]; deferred: string[] } {
  if (tasks.length === 0) return { kept: tasks, deferred: [] };
  const total = sumCognitiveCost(tasks, annotations);
  if (total <= budget) return { kept: tasks, deferred: [] };

  // Sort descending by (tier rank, cost) so the LAST item is the lowest-tier
  // heaviest — the best candidate to defer first.
  const dropOrder = tasks.slice().sort((a, b) => {
    const aa = annotations[a.id];
    const ab = annotations[b.id];
    const aTier = aa ? TIER_PRIORITY[aa.tier] ?? 3 : 2.5;
    const bTier = ab ? TIER_PRIORITY[ab.tier] ?? 3 : 2.5;
    if (aTier !== bTier) return bTier - aTier;
    const aCost = aa?.cognitiveCost ?? 0;
    const bCost = ab?.cognitiveCost ?? 0;
    return bCost - aCost;
  });

  const deferred = new Set<string>();
  let running = total;
  for (const t of dropOrder) {
    if (running <= budget) break;
    const a = annotations[t.id];
    if (!a) continue; // never defer unannotated tasks
    deferred.add(t.id);
    running -= a.cognitiveCost;
  }
  return {
    kept: tasks.filter((t) => !deferred.has(t.id)),
    deferred: Array.from(deferred),
  };
}

// ── Main runner ────────────────────────────────────────────

export async function runScheduler(
  input: TaskStateInput,
  gatekeeper: GatekeeperResult,
  timeEstimator: TimeEstimatorResult,
  priorityAnnotator?: PriorityAnnotatorResult,
): Promise<SchedulerResult> {
  const userId = getCurrentUserId();
  emitAgentProgress(userId, {
    agentId: "scheduler",
    phase: "running",
    message: "Building schedule and detecting conflicts",
  });

  // ── Phase B: hard cognitive-budget enforcement ────────
  // If priorityAnnotator supplied annotations, sum cognitiveCost and defer
  // lowest-tier tasks to the pending pool when the user's daily budget is
  // exceeded. Reorder within budget by (tier, cost) so high-value work
  // anchors the day. When no annotations, behaviour is unchanged.
  const annotations = priorityAnnotator?.annotations ?? {};
  let workingTasks = gatekeeper.filteredTasks;
  let deferredByBudget: string[] = [];
  if (Object.keys(annotations).length > 0) {
    const budget = await resolveDailyCognitiveBudget();
    const trimmed = enforceCognitiveBudget(workingTasks, annotations, budget);
    workingTasks = orderByTier(trimmed.kept, annotations);
    deferredByBudget = trimmed.deferred;
    if (deferredByBudget.length > 0) {
      console.log(
        `[scheduler] Deferred ${deferredByBudget.length} task(s) over cognitive budget (${budget}):`,
        deferredByBudget,
      );
    }
  }

  // Replace gatekeeper.filteredTasks with the budget-enforced, tier-ordered
  // list for downstream tier-block construction. Gatekeeper's output shape
  // is unchanged; only the membership + order differ.
  const budgetedGatekeeper: GatekeeperResult = {
    ...gatekeeper,
    filteredTasks: workingTasks,
    budgetCheck: {
      ...gatekeeper.budgetCheck,
      tasksDropped: [
        ...gatekeeper.budgetCheck.tasksDropped,
        ...deferredByBudget,
      ],
    },
  };

  // Build the 3-tier schedule in code (using the budget-enforced list).
  const calendarBlocks = buildCalendarBlocks(input);
  const goalBlocks = buildGoalBlocks(budgetedGatekeeper, timeEstimator);
  const taskSlots = buildTaskSlots(budgetedGatekeeper, timeEstimator);

  const tierEnforcement: TierEnforcement = {
    calendarBlocks,
    goalBlocks,
    taskSlots,
  };

  // If no tasks to schedule, skip AI call
  if (budgetedGatekeeper.filteredTasks.length === 0) {
    emitAgentProgress(userId, { agentId: "scheduler", phase: "done" });
    return {
      conflicts: [],
      tierEnforcement,
      reshuffleProposal: null,
      opportunityCost: null,
    };
  }

  // Call AI for conflict detection and reshuffle proposals
  const userMessage = `Today is ${input.date}.

FILTERED TASKS (from Gatekeeper, tier-ordered with budget enforcement applied):
${JSON.stringify(
  budgetedGatekeeper.filteredTasks.map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    signal: t.signal,
    goalId: t.goalId,
    goalTitle: t.goalTitle,
    category: t.category,
    tier: annotations[t.id]?.tier,
    cognitiveLoad: annotations[t.id]?.cognitiveLoad,
    cognitiveCost: annotations[t.id]?.cognitiveCost,
  })),
  null,
  2,
)}

TIME ESTIMATES (from Time Estimator):
${JSON.stringify(timeEstimator.estimates, null, 2)}
Total estimated minutes: ${timeEstimator.totalMinutes}
Exceeds deep-work ceiling: ${timeEstimator.exceedsDeepWorkCeiling}

CALENDAR EVENTS (Tier 1 — fixed, immovable):
${JSON.stringify(calendarBlocks, null, 2)}

GOAL BLOCKS (Tier 2 — protected deep-work windows):
${JSON.stringify(goalBlocks, null, 2)}

TASK SLOTS (Tier 3 — fill remaining gaps):
${JSON.stringify(taskSlots, null, 2)}

Detect any conflicts and propose reshuffle actions if needed. Return JSON only.`;

  const client = getClient();
  let conflicts: CalendarConflict[] = [];
  let reshuffleProposal: ReshuffleAction[] | null = null;
  let opportunityCost: OpportunityCost | null = null;

  if (client) {
    try {
      const response = await client.messages.create({
        model: getModelForTask("scheduler"),
        max_tokens: 2048,
        system: SCHEDULER_SYSTEM,
        messages: [{ role: "user", content: userMessage }],
      });

      const text = response.content
        .filter((b: Anthropic.ContentBlock): b is Anthropic.TextBlock => b.type === "text")
        .map((b: Anthropic.TextBlock) => b.text)
        .join("");

      const aiResult = parseAiResponse(text);
      conflicts = aiResult.conflicts;
      reshuffleProposal = aiResult.reshuffleProposal;
      opportunityCost = aiResult.opportunityCost;
    } catch (err) {
      console.error("[scheduler] AI call failed, returning schedule without conflict analysis:", err);
      const { recordAgentFallback } = await import("../services/signalRecorder");
      recordAgentFallback("scheduler", err instanceof Error ? err.message : String(err)).catch(() => {});
    }
  }

  emitAgentProgress(userId, { agentId: "scheduler", phase: "done" });

  return {
    conflicts,
    tierEnforcement,
    reshuffleProposal,
    opportunityCost,
  };
}
