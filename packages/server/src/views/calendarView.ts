/* NorthStar server — calendar view resolver
 *
 * Returns all tasks for a date range (the unified model — calendar events
 * are now stored as tasks). Also returns goals and vacation mode for the
 * calendar page sidebar.
 */

import * as repos from "../repositories";
import type { DailyTask, Goal } from "@northstar/core";
import { flattenDailyTask } from "./_mappers";

export interface CalendarVacationMode {
  active: boolean;
  startDate: string | null;
  endDate: string | null;
}

export interface CalendarViewArgs {
  startDate: string;
  endDate: string;
}

export interface CalendarView {
  rangeStart: string;
  rangeEnd: string;
  tasks: DailyTask[];
  goals: Goal[];
  vacationMode: CalendarVacationMode;
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

export async function resolveCalendarView(
  args?: Partial<CalendarViewArgs>,
): Promise<CalendarView> {
  const defaults = defaultRange();
  const startDate = args?.startDate || defaults.startDate;
  const endDate = args?.endDate || defaults.endDate;

  const [taskRecords, goals, vacationState] = await Promise.all([
    repos.dailyTasks.listForDateRange(startDate, endDate),
    repos.goals.list(),
    repos.vacationMode.get(),
  ]);

  const tasks = taskRecords.map((r) => flattenDailyTask(r, r.date));
  const expanded = expandRecurring(tasks, startDate, endDate);

  const vacationMode: CalendarVacationMode = vacationState
    ? {
        active: vacationState.active,
        startDate: vacationState.startDate,
        endDate: vacationState.endDate,
      }
    : { active: false, startDate: null, endDate: null };

  return {
    rangeStart: startDate,
    rangeEnd: endDate,
    tasks: expanded,
    goals,
    vacationMode,
  };
}
