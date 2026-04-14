/**
 * Can't-Complete Router — handles tasks the user marks as "can't complete".
 *
 * Routes differently based on the task's source:
 *   - big_goal → Big Goal Coordinator re-evaluates (break down, extend timeline)
 *   - user_created/calendar/repeating_goal → offer reschedule options
 */

import type { TaskSource } from "@northstar/core";
import * as repos from "../../repositories";
import type { DailyTaskRecord } from "../../repositories/dailyTasksRepo";

export interface CantCompleteRequest {
  taskId: string;
  /** Optional reason the user can't complete this */
  reason?: string;
}

export interface CantCompleteResult {
  /** What kind of response the UI should show */
  action: "reschedule" | "big_goal_reevaluate";
  /** The task that can't be completed */
  task: {
    id: string;
    title: string;
    source: TaskSource;
    goalId: string | null;
    goalTitle?: string;
  };
  /** For reschedule action: suggested dates */
  rescheduleOptions?: Array<{
    label: string;
    date: string;
  }>;
  /** For big_goal_reevaluate: context passed to Big Goal Coordinator */
  bigGoalContext?: {
    goalId: string;
    goalTitle: string;
    taskTitle: string;
    reason: string;
  };
}

export async function routeCantComplete(
  request: CantCompleteRequest,
): Promise<CantCompleteResult> {
  const task = await repos.dailyTasks.get(request.taskId);
  if (!task) throw new Error(`Task ${request.taskId} not found`);

  const source = task.source;
  const pl = task.payload as Record<string, unknown>;
  const reason = request.reason ?? "User marked as can't complete";

  // Mark the task as skipped so it doesn't show in the active list
  await repos.dailyTasks.update(request.taskId, {
    payload: { skipped: true, cantCompleteReason: reason },
  });

  if (source === "big_goal" && task.goalId) {
    return routeToBigGoal(task, reason);
  } else {
    return routeToReschedule(task, reason);
  }
}

/** Route big_goal tasks to the Big Goal Coordinator for re-evaluation */
async function routeToBigGoal(
  task: DailyTaskRecord,
  reason: string,
): Promise<CantCompleteResult> {
  // Look up the parent goal for context
  let goalTitle = "Unknown Goal";
  if (task.goalId) {
    const goal = await repos.goals.get(task.goalId);
    if (goal) goalTitle = goal.title;
  }

  return {
    action: "big_goal_reevaluate",
    task: {
      id: task.id,
      title: task.title,
      source: task.source,
      goalId: task.goalId,
      goalTitle,
    },
    bigGoalContext: {
      goalId: task.goalId!,
      goalTitle,
      taskTitle: task.title,
      reason,
    },
  };
}

/** Route user-created/calendar/repeating tasks to reschedule options */
async function routeToReschedule(
  task: DailyTaskRecord,
  _reason: string,
): Promise<CantCompleteResult> {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const formatDate = (d: Date) => d.toISOString().split("T")[0];
  const dayName = (d: Date) =>
    d.toLocaleDateString("en-US", { weekday: "long" });

  return {
    action: "reschedule",
    task: {
      id: task.id,
      title: task.title,
      source: task.source,
      goalId: task.goalId,
    },
    rescheduleOptions: [
      { label: `Tomorrow (${dayName(tomorrow)})`, date: formatDate(tomorrow) },
      { label: `Next ${dayName(nextWeek)}`, date: formatDate(nextWeek) },
      { label: "Pick a date...", date: "" },
    ],
  };
}
