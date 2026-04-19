/* NorthStar server — calendar view resolver
 *
 * Returns all tasks for a date range (the unified model — calendar events
 * are now stored as tasks). Also returns goals and vacation mode for the
 * calendar page sidebar.
 */

import * as repos from "../repositories";
import type { DailyTask, Goal, GoalPlanTaskForCalendar } from "@northstar/core";
import { flattenDailyTask } from "./_mappers";

export interface CalendarVacationMode {
  active: boolean;
  startDate: string | null;
  endDate: string | null;
}

export type CalendarViewMode = "month" | "week" | "day" | "project";

export interface CalendarViewArgs {
  startDate: string;
  endDate: string;
  viewMode?: CalendarViewMode;
}

export interface ProjectTimeAllocation {
  projectTag: string | null;   // null = "unassigned"
  totalMinutes: number;
  percentOfRange: number;
  taskCount: number;
}

export interface CalendarView {
  rangeStart: string;
  rangeEnd: string;
  viewMode: CalendarViewMode;
  tasks: DailyTask[];
  goalPlanTasks: GoalPlanTaskForCalendar[];
  goals: Goal[];
  vacationMode: CalendarVacationMode;
  projectAllocation?: ProjectTimeAllocation[];
}

function defaultRange(): CalendarViewArgs {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  return {
    startDate: start.toISOString().split("T")[0],
    endDate: end.toISOString().split("T")[0],
  };
}

/**
 * Expand recurring tasks into virtual instances within the given date range.
 * The original task row stays on its own date; virtual copies get a
 * deterministic `${id}::${date}` ID so the UI can distinguish them.
 */
function expandRecurring(
  tasks: DailyTask[],
  rangeStart: string,
  rangeEnd: string,
): DailyTask[] {
  const result: DailyTask[] = [];

  for (const t of tasks) {
    result.push(t);

    if (!t.recurring || !t.date) continue;

    const origDate = new Date(t.date + "T00:00:00");
    const end = new Date(rangeEnd + "T00:00:00");
    const until = t.recurring.until
      ? new Date(t.recurring.until + "T00:00:00")
      : end;
    const limit = until < end ? until : end;
    const start = new Date(rangeStart + "T00:00:00");

    for (
      let d = new Date(origDate);
      d <= limit;
      d.setDate(d.getDate() + 1)
    ) {
      const dateStr = d.toISOString().split("T")[0];
      if (dateStr === t.date) continue; // skip original
      if (dateStr < rangeStart) continue;

      let match = false;
      if (t.recurring.frequency === "daily") {
        match = true;
      } else if (t.recurring.frequency === "weekly") {
        match = d.getDay() === origDate.getDay();
      } else if (t.recurring.frequency === "monthly") {
        match = d.getDate() === origDate.getDate();
      }

      if (match) {
        result.push({
          ...t,
          id: `${t.id}::${dateStr}`,
          date: dateStr,
          completed: false,
          completedAt: undefined,
        });
      }
    }
  }

  return result;
}

function computeProjectAllocation(tasks: DailyTask[]): ProjectTimeAllocation[] {
  const groups = new Map<string | null, { totalMinutes: number; taskCount: number }>();
  for (const t of tasks) {
    const tag = t.projectTag ?? null;
    const minutes = t.estimatedDurationMinutes ?? t.durationMinutes ?? 0;
    const existing = groups.get(tag) ?? { totalMinutes: 0, taskCount: 0 };
    existing.totalMinutes += minutes;
    existing.taskCount += 1;
    groups.set(tag, existing);
  }
  const rangeTotal = Array.from(groups.values()).reduce((s, g) => s + g.totalMinutes, 0);
  return Array.from(groups.entries()).map(([projectTag, g]) => ({
    projectTag,
    totalMinutes: g.totalMinutes,
    taskCount: g.taskCount,
    percentOfRange: rangeTotal > 0 ? Math.round((g.totalMinutes / rangeTotal) * 1000) / 10 : 0,
  })).sort((a, b) => b.totalMinutes - a.totalMinutes);
}

export async function resolveCalendarView(
  args?: Partial<CalendarViewArgs>,
): Promise<CalendarView> {
  const defaults = defaultRange();
  const startDate = args?.startDate || defaults.startDate;
  const endDate = args?.endDate || defaults.endDate;
  const viewMode: CalendarViewMode = args?.viewMode ?? "month";

  const [taskRecords, goals, vacationState, goalPlanTasksRaw] = await Promise.all([
    repos.dailyTasks.listForDateRange(startDate, endDate),
    repos.goals.list(),
    repos.vacationMode.get(),
    repos.goalPlan.listTasksForDateRange(startDate, endDate),
  ]);

  const tasks = taskRecords.map((r) => flattenDailyTask(r, r.date));
  const expanded = expandRecurring(tasks, startDate, endDate);

  // Deduplicate: filter out goal plan tasks that already have a
  // corresponding daily_tasks row (matched by planNodeId).
  const existingPlanNodeIds = new Set(
    taskRecords
      .map((r) => r.planNodeId)
      .filter(Boolean) as string[],
  );
  const goalPlanTasks = goalPlanTasksRaw.filter(
    (t) => !existingPlanNodeIds.has(t.id),
  );

  const vacationMode: CalendarVacationMode = vacationState
    ? {
        active: vacationState.active,
        startDate: vacationState.startDate,
        endDate: vacationState.endDate,
      }
    : { active: false, startDate: null, endDate: null };

  const projectAllocation =
    viewMode === "project" ? computeProjectAllocation(expanded) : undefined;

  return {
    rangeStart: startDate,
    rangeEnd: endDate,
    viewMode,
    tasks: expanded,
    goalPlanTasks,
    goals,
    vacationMode,
    projectAllocation,
  };
}
