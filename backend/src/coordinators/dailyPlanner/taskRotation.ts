/**
 * Smart Task Rotation — triggered after ANY task is completed.
 *
 * Checks remaining cognitive budget and auto-inserts the next best task
 * from any source (user pool or goal plans) into today's daily_tasks.
 * Called from cmdToggleTask regardless of the completed task's `source`
 * — completing a user-created task should refill the day just as
 * completing a big-goal task does.
 *
 * Priority order:
 *   1. User-created pool tasks with today's date (user explicitly scheduled)
 *   2. Same goal, next chronological plan task (today / overdue) —
 *      skipped when completedGoalId is null
 *   3. Cross-goal: fairness scoring (underserved goals, importance, urgency)
 *   4. User-created pool tasks with no date (unscheduled general tasks)
 *   5. Future-day plan tasks (within 7d horizon) — inserted as BONUS so
 *      the user can complete tomorrow's work in advance when today is
 *      done. Marked `priority: "bonus"` + `isBonus: true` to match the
 *      cmdGenerateBonusTask convention; the FE shows them with the
 *      same affordance.
 *
 * Only rotates 1 task at a time. Respects cognitive budget. The 1:1
 * "complete one → one new appears" cadence is intentional: looping to
 * fill the budget at every completion would surprise the user. The
 * task list stays the same size, just rotates fresh content in.
 */

import * as crypto from "node:crypto";
import * as repos from "../../repositories";
import { packageCurrentPlan } from "./memoryPackager";
import { computeCognitiveWeight } from "@starward/core";
import type { GoalPlanTaskForCalendar } from "../../repositories/goalPlanRepo";
import type { TaskSource } from "@starward/core";

export interface TaskRotationResult {
  rotated: boolean;
  reason: "inserted" | "no-budget" | "no-candidates" | "none-fit";
  insertedTask?: {
    id: string;
    title: string;
    goalId: string;
    goalTitle: string;
  };
}

const IMPORTANCE_WEIGHTS: Record<string, number> = {
  critical: 40,
  high: 30,
  medium: 20,
  low: 10,
};

function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T12:00:00");
  const b = new Date(to + "T12:00:00");
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function scoreCandidate(
  candidate: GoalPlanTaskForCalendar,
  goalsWithActiveTasksToday: Set<string>,
  today: string,
): number {
  let score = 0;

  // Fairness: goals with NO active tasks today get priority
  if (!goalsWithActiveTasksToday.has(candidate.goalId)) {
    score += 100;
  }

  // Importance
  score += IMPORTANCE_WEIGHTS[candidate.goalImportance] ?? 20;

  // Chronological urgency — only today or overdue tasks are candidates
  const daysOverdue = daysBetween(candidate.date, today);
  if (daysOverdue === 0) score += 50;       // scheduled for today
  else if (daysOverdue > 0) score += 30;    // overdue (past date)

  return score;
}

export async function rotateNextTask(
  completedTaskId: string,
  completedGoalId: string | null,
  today: string,
): Promise<TaskRotationResult> {
  // 1. Budget check
  const pkg = await packageCurrentPlan(today);
  const { remainingWeight, remainingSlots } = pkg.budget;
  if (remainingWeight <= 0 || remainingSlots <= 0) {
    return { rotated: false, reason: "no-budget" };
  }

  // Collect goals with active tasks today for fairness scoring
  const goalsWithActiveTasksToday = new Set<string>();
  for (const t of pkg.existingTasks) {
    if (!t.completed && !t.skipped && t.source === "big_goal") {
      const task = await repos.dailyTasks.get(t.id);
      if (task?.goalId) goalsWithActiveTasksToday.add(task.goalId);
    }
  }

  // 2. Priority 1 — User pool tasks with today's date
  const poolTasks = await repos.pendingTasks.listPooledForDate(today);
  const datedPoolTasks = poolTasks.filter((pt) => {
    const analysis = (pt.payload.analysis ?? {}) as Record<string, unknown>;
    const suggestedDate =
      (analysis.suggestedDate as string) ||
      (pt.payload.suggestedDate as string);
    return suggestedDate === today;
  });

  for (const pt of datedPoolTasks) {
    const analysis = (pt.payload.analysis ?? {}) as Record<string, unknown>;
    const weight = (analysis.cognitiveWeight as number) ?? 3;
    const minutes = (analysis.durationMinutes as number) ?? 30;
    if (weight <= remainingWeight && minutes <= pkg.budget.remainingMinutes) {
      const taskId = crypto.randomUUID();
      await repos.dailyTasks.insert({
        id: taskId,
        date: today,
        title: (analysis.title as string) || pt.title || "Untitled",
        completed: false,
        orderIndex: pkg.existingTasks.length,
        source: "user_created" as TaskSource,
        payload: {
          description: (analysis.description as string) || "",
          durationMinutes: minutes,
          cognitiveWeight: weight,
          priority: (analysis.priority as string) || "should-do",
          category: (analysis.category as string) || "planning",
          whyToday: "Auto-rotated: scheduled for today",
          source: "pool-rotated",
          rotatedFromTaskId: completedTaskId,
        },
      });
      await repos.pendingTasks.updateStatus(pt.id, "confirmed");
      return {
        rotated: true,
        reason: "inserted",
        insertedTask: {
          id: taskId,
          title: (analysis.title as string) || pt.title || "Untitled",
          goalId: "",
          goalTitle: "User Tasks",
        },
      };
    }
  }

  // 3. Priority 2 — Same-goal plan tasks (skipped when no goalId, e.g.
  //    after completing a user-created task with no plan attachment).
  if (completedGoalId) {
    const sameGoalTasks = await repos.goalPlan.listNextUncompletedTasks(
      completedGoalId,
      today,
      3,
    );
    for (const candidate of sameGoalTasks) {
      const weight = computeCognitiveWeight(
        candidate.goalImportance,
        candidate.durationMinutes,
        candidate.priority,
      );
      if (weight <= remainingWeight) {
        return insertPlanTask(candidate, weight, today, pkg.existingTasks.length, completedTaskId);
      }
    }
  }

  // 4. Priority 3 — Cross-goal plan tasks (scored by fairness)
  const allGoalTasks = await repos.goalPlan.listNextUncompletedTasks(
    null,
    today,
    20,
  );
  const scored = allGoalTasks
    .map((c) => ({
      candidate: c,
      weight: computeCognitiveWeight(c.goalImportance, c.durationMinutes, c.priority),
      score: scoreCandidate(c, goalsWithActiveTasksToday, today),
    }))
    .filter((s) => s.weight <= remainingWeight)
    .sort((a, b) => b.score - a.score);

  if (scored.length > 0) {
    const best = scored[0];
    return insertPlanTask(
      best.candidate,
      best.weight,
      today,
      pkg.existingTasks.length,
      completedTaskId,
    );
  }

  // 5. Priority 4 — User pool tasks with no date
  const undatedPoolTasks = poolTasks.filter((pt) => {
    const analysis = (pt.payload.analysis ?? {}) as Record<string, unknown>;
    const suggestedDate =
      (analysis.suggestedDate as string) ||
      (pt.payload.suggestedDate as string);
    return !suggestedDate;
  });

  for (const pt of undatedPoolTasks) {
    const analysis = (pt.payload.analysis ?? {}) as Record<string, unknown>;
    const weight = (analysis.cognitiveWeight as number) ?? 3;
    const minutes = (analysis.durationMinutes as number) ?? 30;
    if (weight <= remainingWeight && minutes <= pkg.budget.remainingMinutes) {
      const taskId = crypto.randomUUID();
      await repos.dailyTasks.insert({
        id: taskId,
        date: today,
        title: (analysis.title as string) || pt.title || "Untitled",
        completed: false,
        orderIndex: pkg.existingTasks.length,
        source: "user_created" as TaskSource,
        payload: {
          description: (analysis.description as string) || "",
          durationMinutes: minutes,
          cognitiveWeight: weight,
          priority: (analysis.priority as string) || "should-do",
          category: (analysis.category as string) || "planning",
          whyToday: "Auto-rotated: filling available capacity",
          source: "pool-rotated",
          rotatedFromTaskId: completedTaskId,
        },
      });
      await repos.pendingTasks.updateStatus(pt.id, "confirmed");
      return {
        rotated: true,
        reason: "inserted",
        insertedTask: {
          id: taskId,
          title: (analysis.title as string) || pt.title || "Untitled",
          goalId: "",
          goalTitle: "User Tasks",
        },
      };
    }
  }

  // 6. Priority 5 — Future-day plan tasks (bonus tier). Today's pipeline
  //    is exhausted; pull tomorrow/+1/+2/... up to a 7-day horizon and
  //    insert as a bonus the user can do in advance. Cross-goal so the
  //    same fairness signal applies.
  const futurePlanTasks = await repos.goalPlan.listNextFutureTasks(
    null,
    today,
    7,
    10,
  );
  for (const candidate of futurePlanTasks) {
    const weight = computeCognitiveWeight(
      candidate.goalImportance,
      candidate.durationMinutes,
      candidate.priority,
    );
    if (weight <= remainingWeight && candidate.durationMinutes <= pkg.budget.remainingMinutes) {
      return insertBonusFutureTask(
        candidate,
        weight,
        today,
        pkg.existingTasks.length,
        completedTaskId,
      );
    }
  }

  return { rotated: false, reason: "no-candidates" };
}

async function insertPlanTask(
  candidate: GoalPlanTaskForCalendar,
  weight: number,
  today: string,
  orderIndex: number,
  completedTaskId: string,
): Promise<TaskRotationResult> {
  const taskId = crypto.randomUUID();
  await repos.dailyTasks.insert({
    id: taskId,
    date: today,
    goalId: candidate.goalId,
    planNodeId: candidate.id,
    title: candidate.title,
    completed: false,
    orderIndex,
    source: "big_goal" as TaskSource,
    payload: {
      description: candidate.description || "",
      durationMinutes: candidate.durationMinutes,
      cognitiveWeight: weight,
      priority: candidate.priority,
      category: candidate.category || "planning",
      whyToday: `Auto-rotated: next task from ${candidate.goalTitle}`,
      source: "auto-rotated",
      rotatedFromTaskId: completedTaskId,
    },
  });
  return {
    rotated: true,
    reason: "inserted",
    insertedTask: {
      id: taskId,
      title: candidate.title,
      goalId: candidate.goalId,
      goalTitle: candidate.goalTitle,
    },
  };
}

/**
 * Insert a FUTURE-dated plan task as a bonus on today. The plan node's
 * scheduled day is in the future (tomorrow / +N within the rotation
 * horizon), but we let the user complete it today as a get-ahead bonus.
 *
 * Uses `priority: "bonus"` + `payload.isBonus: true` so it matches the
 * cmdGenerateBonusTask convention — the FE renders bonuses with a
 * distinct affordance and the view excludes them from KPIs (see
 * tasksView.ts:354 `!isBonusTask(t)`).
 */
async function insertBonusFutureTask(
  candidate: GoalPlanTaskForCalendar,
  weight: number,
  today: string,
  orderIndex: number,
  completedTaskId: string,
): Promise<TaskRotationResult> {
  const taskId = crypto.randomUUID();
  await repos.dailyTasks.insert({
    id: taskId,
    date: today,
    goalId: candidate.goalId,
    planNodeId: candidate.id,
    title: candidate.title,
    completed: false,
    orderIndex,
    source: "big_goal" as TaskSource,
    payload: {
      description: candidate.description || "",
      durationMinutes: candidate.durationMinutes,
      cognitiveWeight: weight,
      priority: "bonus",
      category: candidate.category || "planning",
      whyToday: `Bonus: working ahead on ${candidate.goalTitle} (${candidate.date})`,
      source: "auto-rotated-bonus",
      isBonus: true,
      originallyScheduledFor: candidate.date,
      rotatedFromTaskId: completedTaskId,
    },
  });
  return {
    rotated: true,
    reason: "inserted",
    insertedTask: {
      id: taskId,
      title: candidate.title,
      goalId: candidate.goalId,
      goalTitle: candidate.goalTitle,
    },
  };
}
