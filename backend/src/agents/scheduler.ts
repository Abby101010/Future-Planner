/* ──────────────────────────────────────────────────────────
   NorthStar — Scheduler Sub-Agent

   Builds a 3-tier schedule from calendar events, goal blocks,
   and task slots, then calls Haiku for conflict detection and
   reshuffle proposals.
   ────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import { getClient } from "../ai/client";
import {
  emitAgentProgress,
  emitAgentBudgetComputed,
  emitViewInvalidate,
} from "../ws";
import { getCurrentUserId } from "../middleware/requestContext";
import {
  getModelForTask,
  USER_SEGMENTS,
  type UserSegment,
  matchTasksToSlots,
  type AvailabilitySlot,
  type MatcherTask,
  type ExistingAssignment,
  type SlotAssignment,
  computeDynamicBudget,
  type BudgetTrend,
  type DynamicBudgetResult,
  computeFinalScoreBreakdown,
  type FinalScoreTier,
  type HourEnergyWeight,
} from "@northstar/core";
import { loadEnergyStatsForDayOfWeek } from "../services/energyProfile";
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

const VALID_SEGMENT = new Set<string>(USER_SEGMENTS);
function resolveSegment(input?: UserSegment | string | null): UserSegment {
  if (input && VALID_SEGMENT.has(String(input))) return input as UserSegment;
  return "general";
}
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

/** A-3: delegate to the pure calculator. Passes `profile` through so trend +
 *  recent completion rate shape the effective budget. Defaults (trend="stable",
 *  rate=0.8) reproduce Phase-1 output byte-for-byte when no profile is
 *  supplied — the ARCHITECTURE_UPGRADES §9 invariant. */
async function resolveDailyCognitiveBudget(
  segment: UserSegment = "general",
  now: Date = new Date(),
  profile?: { trend?: BudgetTrend; recentCompletionRate?: number } | null,
): Promise<DynamicBudgetResult> {
  let base = DEFAULT_DAILY_COGNITIVE_BUDGET;
  try {
    const user = await repos.users.get();
    const n = user?.settings?.dailyCognitiveBudget;
    if (typeof n === "number" && n > 0) base = n;
  } catch {
    // fall through to default
  }

  return computeDynamicBudget({
    base,
    segment,
    dayOfWeek: now.getDay(),
    trend: profile?.trend,
    recentCompletionRate: profile?.recentCompletionRate,
  });
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
 *  value, so don't drop it first).
 *
 *  A-4: when `arbitration` is supplied, replace the within-tier tiebreak with
 *  the blended finalScore (tier weight × priorityScore × recency). Flag-off
 *  → byte-identical Phase-1 (tier, cost desc) ordering. */
function orderByTier(
  tasks: TriagedTask[],
  annotations: Record<string, PriorityAnnotation>,
  _segment: UserSegment = "general",
  arbitration?: {
    priorityScores: Record<string, number>;
    daysSinceLastWorked: Record<string, number>;
  } | null,
): TriagedTask[] {
  // `_segment` is threaded now so Phase 4 can introduce per-segment ordering
  // without reshuffling call sites. For Phase 1 the ordering is segment-
  // agnostic; presence invariants are enforced in enforceCognitiveBudget.
  if (arbitration) {
    const scored = tasks.map((t) => {
      const a = annotations[t.id];
      const tier = (a?.tier ?? "day") as FinalScoreTier;
      const breakdown = computeFinalScoreBreakdown({
        tier,
        priorityScore: arbitration.priorityScores[t.id],
        daysSinceLastWorked: arbitration.daysSinceLastWorked[t.id],
      });
      return { task: t, breakdown, cost: a?.cognitiveCost ?? 0 };
    });
    scored.sort(
      (x, y) =>
        y.breakdown.finalScore - x.breakdown.finalScore || x.cost - y.cost,
    );
    return scored.map((s) => s.task);
  }

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
  segment: UserSegment = "general",
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

    // Freelancer: never displace lifetime/quarter tier work with day-tier
    // admin, even when the budget would otherwise demand it.
    if (segment === "freelancer" && (a.tier === "lifetime" || a.tier === "quarter")) {
      continue;
    }

    deferred.add(t.id);
    running -= a.cognitiveCost;
  }

  // Career-transition: at least one quarter-tier task must remain in the
  // day. If budget-pressure wiped them all out, restore the lowest-cost
  // deferred quarter task; if that puts us back over budget, trade for the
  // lowest-value day-tier still kept.
  if (segment === "career-transition") {
    const keptHasQuarter = tasks.some(
      (t) => !deferred.has(t.id) && annotations[t.id]?.tier === "quarter",
    );
    if (!keptHasQuarter) {
      const restorable = Array.from(deferred)
        .map((id) => ({ id, a: annotations[id] }))
        .filter((x) => x.a?.tier === "quarter")
        .sort((x, y) => (x.a!.cognitiveCost ?? 0) - (y.a!.cognitiveCost ?? 0));
      const restore = restorable[0];
      if (restore) {
        deferred.delete(restore.id);
        running += restore.a!.cognitiveCost;
        // If we're now over budget, swap in by deferring the lowest-cost
        // day-tier task currently kept.
        while (running > budget) {
          const candidate = tasks
            .filter((t) => !deferred.has(t.id) && annotations[t.id]?.tier === "day")
            .sort(
              (x, y) =>
                (annotations[x.id]?.cognitiveCost ?? 0) -
                (annotations[y.id]?.cognitiveCost ?? 0),
            )[0];
          if (!candidate) break;
          deferred.add(candidate.id);
          running -= annotations[candidate.id]!.cognitiveCost;
        }
      }
    }
  }

  return {
    kept: tasks.filter((t) => !deferred.has(t.id)),
    deferred: Array.from(deferred),
  };
}

// ── B-2: weeklyAvailability / cognitiveLoad slot assignment ─

/** Convert JS Date.getDay() (0=Sun..6=Sat) into the TimeBlock convention
 *  used by `weeklyAvailability` (0=Mon..6=Sun). */
function jsDayToTimeBlockDay(jsDay: number): number {
  return jsDay === 0 ? 6 : jsDay - 1;
}

async function assignSlotsForToday(args: {
  userId: string;
  date: string;
  tasks: TriagedTask[];
  annotations: Record<string, PriorityAnnotation>;
  timeEstimator: TimeEstimatorResult;
  weeklyAvailability: NonNullable<
    Awaited<ReturnType<typeof repos.users.get>>
  >["weeklyAvailability"];
  scheduledTasks: TaskStateInput["scheduledTasks"];
  /** B-3: when true, load per-(hour, dow, category) completion weights and
   *  pass them to the matcher as a tie-break. Default false → byte-identical B-2. */
  energyEnabled?: boolean;
}): Promise<void> {
  const {
    userId,
    date,
    tasks,
    annotations,
    timeEstimator,
    weeklyAvailability,
    scheduledTasks,
    energyEnabled,
  } = args;

  // Parse YYYY-MM-DD into local calendar date and map to 0=Mon..6=Sun.
  const [y, m, d] = date.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return;
  const jsDay = new Date(y, m - 1, d).getDay();
  const tbDay = jsDayToTimeBlockDay(jsDay);

  const slots: AvailabilitySlot[] = (weeklyAvailability ?? [])
    .filter((tb) => tb.day === tbDay)
    .map((tb) => ({
      day: tb.day,
      hour: tb.hour,
      importance: tb.importance,
      label: tb.label,
    }));
  if (slots.length === 0) return;

  const existingAssignments: ExistingAssignment[] = [];
  for (const st of scheduledTasks) {
    if (!st.scheduledTime || !st.scheduledEndTime) continue;
    existingAssignments.push({
      startIso: `${date}T${st.scheduledTime}:00`,
      endIso: `${date}T${st.scheduledEndTime}:00`,
    });
  }

  const matcherTasks: MatcherTask[] = tasks.map((t) => {
    const est = timeEstimator.estimates[t.id];
    const duration = est
      ? est.adjustedMinutes + est.bufferMinutes
      : t.durationMinutes > 0
        ? t.durationMinutes
        : 30;
    return {
      id: t.id,
      cognitiveLoad: annotations[t.id]?.cognitiveLoad,
      durationMinutes: duration,
      category: t.category,
    };
  });

  // B-3: when data-driven energy matching is on, pull today's energy stats
  // once and pass them to the matcher as a tie-break. Failure here must not
  // break B-2's core slot assignment, so we fall back to an empty list.
  let hourEnergyWeights: HourEnergyWeight[] | undefined;
  if (energyEnabled) {
    try {
      const stats = await loadEnergyStatsForDayOfWeek(tbDay);
      hourEnergyWeights = stats.map((s) => ({
        hour: s.hour,
        dayOfWeek: s.dayOfWeek,
        category: s.category,
        completionRate: s.completionRate,
      }));
    } catch (err) {
      console.error("[scheduler] B-3 energy-stats load failed:", err);
      hourEnergyWeights = undefined;
    }
  }

  const assignments: SlotAssignment[] = matchTasksToSlots({
    tasks: matcherTasks,
    slots,
    dateIso: date,
    existingAssignments,
    hourEnergyWeights,
  });
  if (assignments.length === 0) return;

  for (const a of assignments) {
    // Matcher emits naive local ISO (`YYYY-MM-DDTHH:MM:00`); derive HH:MM
    // directly for the legacy payload fields.
    const startHHMM = a.startIso.slice(11, 16);
    const endHHMM = a.endIso.slice(11, 16);
    try {
      await repos.dailyTasks.update(a.taskId, {
        scheduledStartIso: a.startIso,
        scheduledEndIso: a.endIso,
        payload: {
          scheduledTime: startHHMM,
          scheduledEndTime: endHHMM,
        },
      });
    } catch (err) {
      console.error(
        `[scheduler] B-2: failed to persist slot for ${a.taskId}:`,
        err,
      );
    }
  }

  emitViewInvalidate(userId, { viewKinds: ["view:calendar", "view:tasks"] });
  console.log(
    `[scheduler] B-2: assigned ${assignments.length} task(s) to availability slots`,
  );
}

// ── Main runner ────────────────────────────────────────────

export async function runScheduler(
  input: TaskStateInput,
  gatekeeper: GatekeeperResult,
  timeEstimator: TimeEstimatorResult,
  priorityAnnotator?: PriorityAnnotatorResult,
  /** A-3: optional CapacityProfile-shaped object so the dynamic budget can
   *  consider recent trend + completion rate. When absent, defaults reproduce
   *  Phase-1 scheduler output byte-for-byte. */
  capacityProfile?: { trend?: BudgetTrend; recentCompletionRate?: number } | null,
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
  //
  // Segment affects (a) budget multiplier for side-project, (b) a lifetime
  // /quarter deferral guard for freelancer, (c) a quarter-tier anchor for
  // career-transition. Unknown or absent segments resolve to "general" and
  // the logic is byte-identical to pre-segment behaviour.
  let segment: UserSegment = "general";
  let user: Awaited<ReturnType<typeof repos.users.get>> | null = null;
  try {
    user = await repos.users.get();
    segment = resolveSegment(user?.settings?.userSegment);
  } catch {
    // keep "general"
  }

  const annotations = priorityAnnotator?.annotations ?? {};
  let workingTasks = gatekeeper.filteredTasks;
  let deferredByBudget: string[] = [];
  if (Object.keys(annotations).length > 0) {
    const now = new Date();
    // A-3: derive the dynamic profile the calculator needs. Caller may pass
    // one explicitly (preferred); otherwise fall back to `input.recentCompletionRate`
    // (a 0..100 percentage) with trend defaulted to "stable". A rate of -1
    // means "unknown", which the calculator treats as neutral (= Phase-1
    // byte-identical output).
    const resolvedProfile =
      capacityProfile ??
      (typeof input.recentCompletionRate === "number" &&
      input.recentCompletionRate >= 0
        ? { recentCompletionRate: input.recentCompletionRate / 100 }
        : undefined);

    const budgetResult = await resolveDailyCognitiveBudget(
      segment,
      now,
      resolvedProfile,
    );
    const budget = budgetResult.effective;

    // A-3: broadcast the effective budget + base + multipliers. Critique &
    // harness read this instead of re-deriving. Fire-and-forget; never blocks.
    try {
      emitAgentBudgetComputed(userId, {
        agentId: "scheduler",
        effectiveBudget: budget,
        baseBudget: budgetResult.base,
        segment,
        dayOfWeek: now.getDay(),
        multipliers: budgetResult.appliedMultipliers,
      });
    } catch {
      // non-fatal
    }

    const trimmed = enforceCognitiveBudget(workingTasks, annotations, budget, segment);

    // A-4: opt-in two-channel arbitration. Off by default → byte-identical
    // Phase-1 (tier, cost desc) ordering. When on, reorder the kept set by
    // finalScore blended from tier × priorityScore × recency.
    const arbitrationEnabled =
      user?.settings?.priorityArbitrationEnabled === true;
    let arbitration: {
      priorityScores: Record<string, number>;
      daysSinceLastWorked: Record<string, number>;
    } | null = null;
    if (arbitrationEnabled) {
      const daysMap: Record<string, number> = {};
      for (const g of input.goals) {
        for (const t of g.planTasksToday) {
          daysMap[t.id] = g.daysSinceLastWorked;
        }
      }
      arbitration = {
        priorityScores: gatekeeper.priorityScores ?? {},
        daysSinceLastWorked: daysMap,
      };
    }
    workingTasks = orderByTier(trimmed.kept, annotations, segment, arbitration);
    deferredByBudget = trimmed.deferred;

    console.log(
      `[scheduler] arbitration=${arbitrationEnabled ? "on" : "off"} (kept=${workingTasks.length})`,
    );
    if (arbitrationEnabled && arbitration) {
      const top5 = workingTasks.slice(0, 5).map((t) => {
        const a = annotations[t.id];
        const tier = (a?.tier ?? "day") as FinalScoreTier;
        const breakdown = computeFinalScoreBreakdown({
          tier,
          priorityScore: arbitration!.priorityScores[t.id],
          daysSinceLastWorked: arbitration!.daysSinceLastWorked[t.id],
        });
        return {
          id: t.id,
          title: t.title,
          tier,
          finalScore: Number(breakdown.finalScore.toFixed(2)),
          components: {
            tier: Number(breakdown.tierComponent.toFixed(2)),
            priority: Number(breakdown.priorityComponent.toFixed(2)),
            recency: Number(breakdown.recencyComponent.toFixed(2)),
          },
        };
      });
      console.log("[scheduler] arbitration top5:", JSON.stringify(top5));
    }
    if (deferredByBudget.length > 0) {
      console.log(
        `[scheduler] Deferred ${deferredByBudget.length} task(s) over cognitive budget (effective=${budget}, base=${budgetResult.base}, segment=${segment}):`,
        deferredByBudget,
      );
    }

    // ── B-2: cognitiveLoad → weeklyAvailability slot matching ──
    // Opt-in via settings.cognitiveLoadMatchingEnabled. When on, map today's
    // tasks to slots whose `importance` matches the task's cognitiveLoad and
    // dual-write scheduled_start/end ISO + legacy HH:MM. Default off → no
    // scheduler-originated time-block writes (byte-identical to pre-B-2).
    if (
      user?.settings?.cognitiveLoadMatchingEnabled === true &&
      Array.isArray(user.weeklyAvailability) &&
      user.weeklyAvailability.length > 0 &&
      workingTasks.length > 0
    ) {
      try {
        await assignSlotsForToday({
          userId,
          date: input.date,
          tasks: workingTasks,
          annotations,
          timeEstimator,
          weeklyAvailability: user.weeklyAvailability,
          scheduledTasks: input.scheduledTasks,
          energyEnabled: user?.settings?.dataDrivenEnergyEnabled === true,
        });
      } catch (err) {
        console.error("[scheduler] B-2 slot matching failed:", err);
      }
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
