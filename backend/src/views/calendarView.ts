/* Starward server — calendar view resolver
 *
 * Returns all tasks for a date range (the unified model — calendar events
 * are now stored as tasks). Also returns goals and vacation mode for the
 * calendar page sidebar.
 *
 * Past-day contract: rows where `date < today` AND `completed === false`
 * are filtered out before returning. Past days show only what was
 * actually completed; incomplete past tasks live on the Tasks page as
 * reschedule candidates (see tasksView.ts `pendingReschedules`) until
 * the user reschedules, drops, or they age out (>90 days, swept by
 * `markStaleAsSkipped`). This keeps the calendar honest about what
 * happened on each past day instead of perpetually displaying tasks
 * that were never done.
 */

import * as repos from "../repositories";
import { getEffectiveDate } from "../dateUtils";
import type {
  DailyTask,
  Goal,
  GoalPlanTaskForCalendar,
  Reminder,
} from "@starward/core";
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

/** Per-date tally powering the month-grid count badges. The UI reads
 *  `countsByDate[YYYY-MM-DD]?.tasks` + `.reminders` to render each cell. */
export interface CalendarDateCounts {
  tasks: number;
  reminders: number;
}

export interface CalendarView {
  rangeStart: string;
  rangeEnd: string;
  viewMode: CalendarViewMode;
  tasks: DailyTask[];
  goalPlanTasks: GoalPlanTaskForCalendar[];
  goals: Goal[];
  vacationMode: CalendarVacationMode;
  /** Reminders whose `date` falls within [rangeStart, rangeEnd]. Powers
   *  the click-a-date side view (filtered client-side by selected date). */
  reminders: Reminder[];
  /** Per-date counts of tasks + reminders for quick badge rendering. */
  countsByDate: Record<string, CalendarDateCounts>;
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
  today: string,
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

    for (
      let d = new Date(origDate);
      d <= limit;
      d.setDate(d.getDate() + 1)
    ) {
      const dateStr = d.toISOString().split("T")[0];
      if (dateStr === t.date) continue; // skip original
      if (dateStr < rangeStart) continue;
      // Honor the past-day contract at the top of this file: virtual
      // recurring instances on past dates render as "uncompleted past
      // tasks" (completed:false hardcoded at line below) which is
      // exactly what the past-day filter is meant to hide. They were
      // never real records, so dropping them prevents false duplicates
      // alongside any real daily_tasks rows for those dates.
      if (dateStr < today) continue;

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

  const [taskRecords, goals, vacationState, goalPlanTasksRaw, allReminders] =
    await Promise.all([
      repos.dailyTasks.listForDateRange(startDate, endDate),
      repos.goals.list(),
      repos.vacationMode.get(),
      repos.goalPlan.listTasksForDateRange(startDate, endDate),
      repos.reminders.list(),
    ]);

  // Reminders repo has no listForDateRange helper yet; fetch-all-and-filter
  // is fine at current scale.
  const reminders: Reminder[] = allReminders.filter(
    (r) => r.date >= startDate && r.date <= endDate,
  );

  // Build goalId→title map so TaskRow / side view can show "from <goal>".
  const goalsById = new Map<string, string>(goals.map((g) => [g.id, g.title]));
  const tasks = taskRecords.map((r) => flattenDailyTask(r, r.date, goalsById));

  // Past-day filter: hide incomplete rows on dates before today. See the
  // contract at the top of this file. Skipped tasks (incl. aged-out)
  // are also hidden — they have a recorded skipReason and don't belong
  // on the visible calendar. Today and future days are unchanged.
  const today = getEffectiveDate();
  const visibleTasks = tasks.filter((t) => {
    if (!t.date || t.date >= today) return true;
    if (t.completed) return true;
    if (t.skipped) return false;
    return false;
  });

  const expanded = expandRecurring(visibleTasks, startDate, endDate, today);

  // Deduplicate: filter out goal plan tasks that already have a
  // corresponding daily_tasks row (matched by planNodeId). Also filter
  // out plan-tree tasks scheduled for past days — same contract as the
  // daily_tasks past-day filter above.
  const existingPlanNodeIds = new Set(
    taskRecords
      .map((r) => r.planNodeId)
      .filter(Boolean) as string[],
  );
  const goalPlanTasks = goalPlanTasksRaw.filter(
    (t) => {
      if (existingPlanNodeIds.has(t.id)) return false;
      if (t.date && t.date < today && !t.completed) return false;
      return true;
    },
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

  // Defensive diagnostic: warn if same-date same-title duplicates slip
  // through dedup. These shouldn't happen given the planNodeId dedup
  // and the past-day filter, but the warn gives us live signal if they
  // ever do (e.g., orphaned daily_tasks from a plan rewrite path that
  // didn't prune, or a future surface that bypasses the resolver's
  // contract). Keep the warn cheap — just count, don't iterate twice.
  if (process.env.NODE_ENV !== "production") {
    const seen = new Map<string, number>();
    for (const t of expanded) {
      const key = `${t.date}|${t.title}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    for (const [key, count] of seen) {
      if (count > 1) {
        console.warn(`[calendarView] duplicate task in expanded set: ${key} (×${count})`);
      }
    }
  }

  // Per-date counts for the month grid. Keys are ISO YYYY-MM-DD, matching
  // both daily_tasks.log_date and reminders.date column shapes.
  const countsByDate: Record<string, CalendarDateCounts> = {};
  const bump = (date: string, key: keyof CalendarDateCounts): void => {
    if (!date) return;
    const existing = countsByDate[date] ?? { tasks: 0, reminders: 0 };
    existing[key] += 1;
    countsByDate[date] = existing;
  };
  for (const t of expanded) bump(t.date ?? "", "tasks");
  for (const gt of goalPlanTasks) bump(gt.date ?? "", "tasks");
  for (const r of reminders) bump(r.date, "reminders");

  return {
    rangeStart: startDate,
    rangeEnd: endDate,
    viewMode,
    tasks: expanded,
    goalPlanTasks,
    goals,
    vacationMode,
    reminders,
    countsByDate,
    projectAllocation,
  };
}
