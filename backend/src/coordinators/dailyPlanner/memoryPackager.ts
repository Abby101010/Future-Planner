/**
 * Memory Packager — preserves current plan state when adding mid-day tasks.
 *
 * When a user adds a task after the daily plan is confirmed, this module:
 * 1. Packages the current plan state (all tasks, completion status, time slots)
 * 2. Evaluates whether the new task fits within the remaining capacity
 * 3. If over budget, returns tasks eligible for deferral (user chooses)
 * 4. Patches the plan without regenerating everything
 */

import * as repos from "../../repositories";
import { totalWeight, totalMinutes, COGNITIVE_BUDGET } from "@northstar/core";
import type { TaskSource } from "@northstar/core";

const { MAX_DAILY_WEIGHT, MAX_DAILY_TASKS, MAX_DEEP_MINUTES } = COGNITIVE_BUDGET;

export interface MemoryPackage {
  /** Current date */
  date: string;
  /** All existing tasks on this day */
  existingTasks: Array<{
    id: string;
    title: string;
    completed: boolean;
    skipped: boolean;
    cognitiveWeight: number;
    durationMinutes: number;
    priority: string;
    source: TaskSource;
  }>;
  /** Current budget usage */
  budget: {
    usedWeight: number;
    usedMinutes: number;
    activeTaskCount: number;
    remainingWeight: number;
    remainingMinutes: number;
    remainingSlots: number;
  };
}

export interface AddTaskResult {
  /** Whether the task was added successfully */
  ok: boolean;
  /** If over budget, tasks that could be deferred to make room */
  deferCandidates?: Array<{
    id: string;
    title: string;
    cognitiveWeight: number;
    durationMinutes: number;
    priority: string;
  }>;
  /** Reason the task couldn't be added */
  reason?: string;
}

/**
 * Package the current plan state for a given date.
 */
export async function packageCurrentPlan(date: string): Promise<MemoryPackage> {
  const taskRecords = await repos.dailyTasks.listForDate(date);

  const existingTasks = taskRecords.map((t) => {
    const pl = t.payload as Record<string, unknown>;
    return {
      id: t.id,
      title: t.title,
      completed: t.completed,
      skipped: (pl?.skipped as boolean) ?? false,
      cognitiveWeight: (pl?.cognitiveWeight as number) ?? 3,
      durationMinutes: (pl?.durationMinutes as number) ?? 30,
      priority: (pl?.priority as string) ?? "should-do",
      source: t.source,
    };
  });

  // Only count active (not completed, not skipped) tasks for budget
  const active = existingTasks.filter((t) => !t.completed && !t.skipped);
  const coreWeight = active.map((t) => ({ cognitiveWeight: t.cognitiveWeight }));
  const coreMinutes = active.map((t) => ({ durationMinutes: t.durationMinutes }));

  const usedWeight = totalWeight(coreWeight);
  const usedMinutes = totalMinutes(coreMinutes);

  return {
    date,
    existingTasks,
    budget: {
      usedWeight,
      usedMinutes,
      activeTaskCount: active.length,
      remainingWeight: MAX_DAILY_WEIGHT - usedWeight,
      remainingMinutes: MAX_DEEP_MINUTES - usedMinutes,
      remainingSlots: MAX_DAILY_TASKS - active.length,
    },
  };
}

/**
 * Check if a new task fits within the remaining budget.
 * If not, return deferral candidates sorted by priority (lowest first).
 */
export function evaluateCapacity(
  pkg: MemoryPackage,
  newTaskWeight: number,
  newTaskMinutes: number,
): AddTaskResult {
  const budget = pkg.budget;

  const fitsWeight = budget.remainingWeight >= newTaskWeight;
  const fitsMinutes = budget.remainingMinutes >= newTaskMinutes;
  const fitsSlots = budget.remainingSlots > 0;

  if (fitsWeight && fitsMinutes && fitsSlots) {
    return { ok: true };
  }

  // Find active, non-completed, non-skipped tasks that could be deferred
  const candidates = pkg.existingTasks
    .filter((t) => !t.completed && !t.skipped)
    .sort((a, b) => {
      // Sort by priority (bonus first, then should-do, then must-do)
      const priRank = (p: string) =>
        p === "must-do" ? 0 : p === "should-do" ? 1 : 2;
      const diff = priRank(b.priority) - priRank(a.priority);
      if (diff !== 0) return diff;
      // Within same priority, defer lighter tasks first
      return a.cognitiveWeight - b.cognitiveWeight;
    })
    .map((t) => ({
      id: t.id,
      title: t.title,
      cognitiveWeight: t.cognitiveWeight,
      durationMinutes: t.durationMinutes,
      priority: t.priority,
    }));

  const reasons: string[] = [];
  if (!fitsWeight) reasons.push(`cognitive load (${budget.usedWeight + newTaskWeight}/${MAX_DAILY_WEIGHT})`);
  if (!fitsMinutes) reasons.push(`time (${budget.usedMinutes + newTaskMinutes}/${MAX_DEEP_MINUTES}min)`);
  if (!fitsSlots) reasons.push(`task count (${budget.activeTaskCount + 1}/${MAX_DAILY_TASKS})`);

  return {
    ok: false,
    deferCandidates: candidates,
    reason: `Over budget: ${reasons.join(", ")}`,
  };
}
