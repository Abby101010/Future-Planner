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
} from "@northstar/core";
import { SCHEDULER_SYSTEM } from "./prompts/scheduler";

// ── Helpers ────────────────────────────────────────────────

/** Build Tier 1 calendar blocks from input events. */
function buildCalendarBlocks(input: TaskStateInput): ScheduleBlock[] {
  return input.calendarEvents.map((e) => {
    const start = new Date(e.startDate);
    const end = new Date(e.endDate);
    const duration = Math.round((end.getTime() - start.getTime()) / 60000);
    return {
      startTime: e.startDate,
      endTime: e.endDate,
      label: e.title,
      tier: "calendar" as const,
      durationMinutes: duration > 0 ? duration : 60,
    };
  });
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

// ── Main runner ────────────────────────────────────────────

export async function runScheduler(
  input: TaskStateInput,
  gatekeeper: GatekeeperResult,
  timeEstimator: TimeEstimatorResult,
): Promise<SchedulerResult> {
  const userId = getCurrentUserId();
  emitAgentProgress(userId, {
    agentId: "scheduler",
    phase: "running",
    message: "Building schedule and detecting conflicts",
  });

  // Build the 3-tier schedule in code
  const calendarBlocks = buildCalendarBlocks(input);
  const goalBlocks = buildGoalBlocks(gatekeeper, timeEstimator);
  const taskSlots = buildTaskSlots(gatekeeper, timeEstimator);

  const tierEnforcement: TierEnforcement = {
    calendarBlocks,
    goalBlocks,
    taskSlots,
  };

  // If no tasks to schedule, skip AI call
  if (gatekeeper.filteredTasks.length === 0) {
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

FILTERED TASKS (from Gatekeeper, sorted by priority):
${JSON.stringify(
  gatekeeper.filteredTasks.map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    signal: t.signal,
    goalId: t.goalId,
    goalTitle: t.goalTitle,
    category: t.category,
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
