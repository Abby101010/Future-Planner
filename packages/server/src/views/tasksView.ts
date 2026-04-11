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
  ContextualNudge,
  DailyLog,
  DailyTask,
  Goal,
  HeatmapEntry,
  Reminder,
} from "@northstar/core";
import type { DailyTaskRecord } from "../repositories/dailyTasksRepo";
import { hydrateDailyLog, nudgeToContextual } from "./_mappers";

export interface TasksVacationMode {
  active: boolean;
  startDate: string | null;
  endDate: string | null;
}

export interface BigGoalProgress {
  goalId: string;
  title: string;
  total: number;
  completed: number;
  percent: number;
}

export interface TodayProgressSummary {
  completed: number;
  total: number;
  /** 0..100 percentage, already rounded to 1 decimal on the server. */
  ratePercent: number;
}

/** Plan-tree task surfaced on today that hasn't been consumed by the
 *  daily_tasks LLM yet. Carries the parent goal + week/day ids so the
 *  page can dispatch a toggle command without re-walking the tree. */
export interface PendingGoalTask extends DailyTask {
  goalTitle: string;
  goalId: string;
  weekId?: string;
  dayId?: string;
}

export interface TasksView {
  todayDate: string;
  todayLog: DailyLog | null;
  /** Up to 90 days of logs (hydrated with tasks). Sorted desc by date. */
  dailyLogs: DailyLog[];
  heatmapData: HeatmapEntry[];
  goals: Goal[];
  bigGoalProgress: BigGoalProgress[];
  activeReminders: Reminder[];
  todayReminders: Reminder[];
  todayEvents: CalendarEvent[];
  recentNudges: ContextualNudge[];
  vacationMode: TasksVacationMode;
  totalIncompleteTasks: number;
  /** Derived: completed/total/ratePercent over today's log. */
  todayProgress: TodayProgressSummary;
  /** Derived: tasks in today's log that remain incomplete. */
  todayMissedTasks: DailyTask[];
  /** Derived: goal-plan tasks scheduled for today that the daily-tasks
   *  LLM hasn't yet pulled into today's log. */
  pendingGoalTasks: PendingGoalTask[];
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

/** Plan generators emit day labels in several shapes ("Monday", "Mon",
 *  "Jan 6", "2026-04-11", etc.). Match against today leniently so the
 *  page surfaces plan tasks regardless of generator style. */
function dayMatchesToday(rawLabel: string, today: string): boolean {
  const label = rawLabel.toLowerCase().trim();
  if (!label) return false;
  const d = new Date(`${today}T00:00:00`);
  const weekdayLong = d
    .toLocaleDateString("en-US", { weekday: "long" })
    .toLowerCase();
  const weekdayShort = d
    .toLocaleDateString("en-US", { weekday: "short" })
    .toLowerCase();
  const monthDay = d
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toLowerCase();
  const monthDayPadded = monthDay.replace(/\s(\d)$/, " 0$1");
  if (label === today || label.includes(today)) return true;
  if (label === weekdayLong || label === weekdayShort) return true;
  if (label.startsWith(`${weekdayShort} `)) return true;
  if (label === monthDay || label.includes(monthDay)) return true;
  if (label === monthDayPadded || label.includes(monthDayPadded)) return true;
  return false;
}

function computePendingGoalTasks(
  goals: Goal[],
  todayLog: DailyLog | null,
  today: string,
): PendingGoalTask[] {
  const consumed = new Set<string>(
    (todayLog?.tasks ?? [])
      .map((t) => t.planNodeId ?? "")
      .filter(Boolean),
  );
  const out: PendingGoalTask[] = [];
  for (const g of goals) {
    if (!g.plan || !Array.isArray(g.plan.years)) continue;
    for (const year of g.plan.years) {
      for (const month of year.months) {
        for (const week of month.weeks) {
          if (week.locked) continue;
          for (const day of week.days) {
            if (!dayMatchesToday(day.label, today)) continue;
            for (const tk of day.tasks) {
              if (tk.completed) continue;
              if (consumed.has(tk.id)) continue;
              out.push({
                ...(tk as unknown as DailyTask),
                goalTitle: g.title,
                goalId: g.id,
                weekId: week.id,
                dayId: day.id,
              });
            }
          }
        }
      }
    }
  }
  return out;
}

function computeTodayProgress(todayLog: DailyLog | null): TodayProgressSummary {
  const tasks = todayLog?.tasks ?? [];
  const completed = tasks.filter((t) => t.completed).length;
  const total = tasks.length;
  const ratePercent = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;
  return { completed, total, ratePercent };
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

  const hydratedLogs: DailyLog[] = logs
    .map((log) => hydrateDailyLog(log, tasksByDate.get(log.date) ?? []))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const todayLog = hydratedLogs.find((l) => l.date === today) ?? null;

  const todayReminders = activeReminders
    .filter((r) => r.date === today)
    .sort((a, b) => a.reminderTime.localeCompare(b.reminderTime));

  const totalIncompleteTasks = hydratedLogs.reduce(
    (sum, log) => sum + log.tasks.filter((t) => !t.completed && !t.skipped).length,
    0,
  );

  const vacationMode: TasksVacationMode = vacationState
    ? {
        active: vacationState.active,
        startDate: vacationState.startDate,
        endDate: vacationState.endDate,
      }
    : { active: false, startDate: null, endDate: null };

  const todayProgress = computeTodayProgress(todayLog);
  const todayMissedTasks = (todayLog?.tasks ?? []).filter((t) => !t.completed);
  const pendingGoalTasks = computePendingGoalTasks(goals, todayLog, today);

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
    recentNudges: nudges.map(nudgeToContextual),
    vacationMode,
    totalIncompleteTasks,
    todayProgress,
    todayMissedTasks,
    pendingGoalTasks,
  };
}
