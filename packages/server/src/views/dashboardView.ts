/* NorthStar server — dashboard view resolver
 *
 * Narrow per-page aggregate for DashboardPage. Composes goals, today's
 * daily log + tasks, today's calendar events, pending tasks, chat
 * messages, active nudges, vacation mode, and the current monthly
 * context into ONE serialization-ready object the client can render
 * without any post-processing.
 *
 * Computed server-side (zero client logic):
 *   - todayDate, greetingName
 *   - completed/total task counts and streak for the today summary
 *   - active goals filter (status !== "archived")
 *   - currentMonthContext selection by month key
 */

import * as repos from "../repositories";
import { getEffectiveDate, getEffectiveMonthKey } from "../dateUtils";
import type {
  CalendarEvent,
  ContextualNudge,
  DailyTask,
  Goal,
  HomeChatMessage,
  MonthlyContext,
  PendingTask,
  Reminder,
} from "@northstar/core";
import { flattenDailyTask, nudgeToContextual } from "./_mappers";

export interface DashboardTodaySummary {
  completedTasks: number;
  totalTasks: number;
  streak: number;
}

export interface DashboardVacationMode {
  active: boolean;
  startDate: string | null;
  endDate: string | null;
}

export interface DashboardDailyLoad {
  currentWeight: number;
  currentMinutes: number;
  activeTaskCount: number;
  todayEventCount: number;
}

export interface DashboardView {
  todayDate: string;
  greetingName: string;
  todaySummary: DashboardTodaySummary;
  activeGoals: Goal[];
  todayTasks: DailyTask[];
  todayEvents: CalendarEvent[];
  pendingTasks: PendingTask[];
  /** Subset of pendingTasks still in an actionable state. */
  activePendingTasks: PendingTask[];
  /** Aggregate overload signals derived from todayTasks + todayEvents. */
  dailyLoad: DashboardDailyLoad;
  homeChatMessages: HomeChatMessage[];
  activeReminders: Reminder[];
  recentNudges: ContextualNudge[];
  vacationMode: DashboardVacationMode;
  currentMonthContext: MonthlyContext | null;
  /** True when the user has not yet set a context for the current
   *  calendar month — DashboardPage uses this to show the month nudge. */
  needsMonthlyContext: boolean;
}

export async function resolveDashboardView(): Promise<DashboardView> {
  const today = getEffectiveDate();

  // ── Fire the independent repo reads in parallel ─────────────
  const [
    goals,
    todayTaskRecords,
    todayEvents,
    pendingRecords,
    homeMessages,
    activeReminders,
    nudgeRecords,
    vacationState,
    monthlyContexts,
    user,
  ] = await Promise.all([
    repos.goals.list(),
    repos.dailyTasks.listForDate(today),
    repos.calendar.listForRange(`${today}T00:00:00`, `${today}T23:59:59`),
    repos.pendingTasks.list(),
    repos.chat.listHomeMessages(200),
    repos.reminders.listActive(),
    repos.nudges.list(true),
    repos.vacationMode.get(),
    repos.monthlyContext.list(),
    repos.users.get(),
  ]);

  const greetingName = user?.name?.trim() || "";

  const todayTasks: DailyTask[] = todayTaskRecords.map(flattenDailyTask);
  const recentNudges: ContextualNudge[] = nudgeRecords.map(nudgeToContextual);

  // Pending tasks in the DB are stored as PendingTaskRecord (source, title,
  // status, payload). We rehydrate a best-effort @northstar/core PendingTask
  // from the payload so the client type-checks without new transforms.
  const pendingTasks: PendingTask[] = pendingRecords.map((p) => {
    const pl = p.payload;
    return {
      id: p.id,
      userInput: (pl.userInput as string) ?? p.title ?? "",
      analysis: (pl.analysis as PendingTask["analysis"]) ?? null,
      status: (p.status as PendingTask["status"]) ?? "analyzing",
      createdAt: p.createdAt,
    };
  });

  const activeGoals = goals.filter((g) => g.status !== "archived");

  const activePendingTasks = pendingTasks.filter(
    (pt) => pt.status === "analyzing" || pt.status === "ready",
  );

  const dailyLoad: DashboardDailyLoad = {
    currentWeight: todayTasks.reduce((sum, t) => sum + (t.cognitiveWeight ?? 3), 0),
    currentMinutes: todayTasks.reduce((sum, t) => sum + (t.durationMinutes ?? 30), 0),
    activeTaskCount: todayTasks.filter((t) => !t.completed).length,
    todayEventCount: todayEvents.length,
  };

  const completedTasks = todayTasks.filter((t) => t.completed).length;
  const totalTasks = todayTasks.length;

  // Current streak is stashed on the daily_log payload by the existing
  // reflection pipeline. Prefer today's log, fall back to 0.
  const todayLog = await repos.dailyLogs.get(today);
  const streak =
    (todayLog?.payload?.heatmapEntry as { currentStreak?: number } | undefined)
      ?.currentStreak ?? 0;

  const vacationMode: DashboardVacationMode = vacationState
    ? {
        active: vacationState.active,
        startDate: vacationState.startDate,
        endDate: vacationState.endDate,
      }
    : { active: false, startDate: null, endDate: null };

  const monthKey = getEffectiveMonthKey();
  const currentMonthContext =
    monthlyContexts.find((c) => c.month === monthKey) ?? null;

  return {
    todayDate: today,
    greetingName,
    todaySummary: { completedTasks, totalTasks, streak },
    activeGoals,
    todayTasks,
    todayEvents,
    pendingTasks,
    activePendingTasks,
    dailyLoad,
    homeChatMessages: homeMessages,
    activeReminders,
    recentNudges,
    vacationMode,
    currentMonthContext,
    needsMonthlyContext: currentMonthContext === null,
  };
}
