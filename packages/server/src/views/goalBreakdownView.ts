/* NorthStar server — goal breakdown view resolver
 *
 * Returns scheduled tasks for the reallocate flow that the page hosts.
 */

import * as repos from "../repositories";
import type { DailyTask, GoalBreakdown } from "@northstar/core";
import { flattenDailyTask } from "./_mappers";

export interface GoalBreakdownViewArgs {
  goalId?: string;
}

export interface GoalBreakdownView {
  goalBreakdown: GoalBreakdown | null;
  scheduledTasks: DailyTask[];
}

export async function resolveGoalBreakdownView(
  _args?: GoalBreakdownViewArgs,
): Promise<GoalBreakdownView> {
  void _args;

  const today = new Date().toISOString().split("T")[0];
  const end = new Date();
  end.setDate(end.getDate() + 90);
  const endISO = end.toISOString().split("T")[0];

  const taskRecords = await repos.dailyTasks.listForDateRange(today, endISO);
  const scheduledTasks = taskRecords
    .filter((r) => (r.payload as Record<string, unknown>).scheduledTime)
    .map((r) => flattenDailyTask(r, r.date));

  return {
    goalBreakdown: null,
    scheduledTasks,
  };
}
