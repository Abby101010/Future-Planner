/* NorthStar server — tasks view resolver
 *
 * Narrow per-page aggregate for TasksPage. Today's daily log (with
 * joined tasks), all daily logs (for the "All tasks" dropdown),
 * heatmap range, active nudges, reminders, goals with progress, and
 * vacation mode.
 *
 * Range for heatmap + dailyLogs is the last 90 days through today —
 * TasksPage never renders older data and we don't want to stream
 * unbounded rows across the wire.
 */

import * as repos from "../repositories";
import type {
  CalendarEvent,
  Goal,
  HeatmapEntry,
  Reminder,
} from "@northstar/core";
import type { DailyLogRecord } from "../repositories/dailyLogsRepo";
import type { DailyTaskRecord } from "../repositories/dailyTasksRepo";
import type { NudgeRecord } from "../repositories/nudgesRepo";

export interface TasksVacationMode {
  active: boolean;
  startDate: string | null;
  endDate: string | null;
}

export interface TasksDailyLogHydrated extends DailyLogRecord {
  tasks: DailyTaskRecord[];
}

export interface BigGoalProgress {
  goalId: string;
  title: string;
  total: number;
  completed: number;
  percent: number;
}

export interface TasksView {
  todayDate: string;
  todayLog: TasksDailyLogHydrated | null;
  /** Up to 90 days of logs (hydrated with tasks). Sorted desc by date. */
  dailyLogs: TasksDailyLogHydrated[];
  heatmapData: HeatmapEntry[];
  goals: Goal[];
  bigGoalProgress: BigGoalProgress[];
  activeReminders: Reminder[];
  todayReminders: Reminder[];
  todayEvents: CalendarEvent[];
  recentNudges: NudgeRecord[];
  vacationMode: TasksVacationMode;
  totalIncompleteTasks: number;
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

function computeBigGoalProgress(goals: Goal[]): BigGoalProgress[] {
  return goals
    .filter(
      (g) =>
        (g.goalType === "big" || (!g.goalType && g.scope === "big")) &&
        g.status !== "archived",
    )
    .map((g) => {
      let total = 0;
      let completed = 0;
      if (g.plan && Array.isArray(g.plan.years)) {
        for (const yr of g.plan.years) {
          for (const mo of yr.months) {
            for (const wk of mo.weeks) {
              for (const dy of wk.days) {
                for (const tk of dy.tasks) {
                  total++;
                  if (tk.completed) completed++;
                }
              }
            }
          }
        }
      }
      return {
        goalId: g.id,
        title: g.title,
        total,
        completed,
        percent: total > 0 ? Math.round((completed / total) * 100) : 0,
      };
    });
}

export async function resolveTasksView(): Promise<TasksView> {
  const today = todayISO();
  const rangeStart = isoDaysAgo(90);

  const [
    goals,
    logs,
    tasksInRange,
    heatmapData,
    activeReminders,
    todayEvents,
    nudges,
    vacationState,
  ] = await Promise.all([
    repos.goals.list(),
    repos.dailyLogs.list(rangeStart, today),
    repos.dailyTasks.listForDateRange(rangeStart, today),
    repos.heatmap.listRange(rangeStart, today),
    repos.reminders.listActive(),
    repos.calendar.listForRange(`${today}T00:00:00`, `${today}T23:59:59`),
    repos.nudges.list(true),
    repos.vacationMode.get(),
  ]);

  // Group tasks by date for cheap hydration.
  const tasksByDate = new Map<string, DailyTaskRecord[]>();
  for (const t of tasksInRange) {
    const arr = tasksByDate.get(t.date) ?? [];
    arr.push(t);
    tasksByDate.set(t.date, arr);
  }

  const hydratedLogs: TasksDailyLogHydrated[] = logs
    .map((log) => ({
      ...log,
      tasks: tasksByDate.get(log.date) ?? [],
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const todayLog = hydratedLogs.find((l) => l.date === today) ?? null;

  const todayReminders = activeReminders
    .filter((r) => r.date === today)
    .sort((a, b) => a.reminderTime.localeCompare(b.reminderTime));

  const totalIncompleteTasks = hydratedLogs.reduce(
    (sum, log) =>
      sum +
      log.tasks.filter(
        (t) => !t.completed && !(t.payload.skipped as boolean | undefined),
      ).length,
    0,
  );

  const vacationMode: TasksVacationMode = vacationState
    ? {
        active: vacationState.active,
        startDate: vacationState.startDate,
        endDate: vacationState.endDate,
      }
    : { active: false, startDate: null, endDate: null };

  return {
    todayDate: today,
    todayLog,
    dailyLogs: hydratedLogs,
    heatmapData,
    goals,
    bigGoalProgress: computeBigGoalProgress(goals),
    activeReminders,
    todayReminders,
    todayEvents,
    recentNudges: nudges,
    vacationMode,
    totalIncompleteTasks,
  };
}
