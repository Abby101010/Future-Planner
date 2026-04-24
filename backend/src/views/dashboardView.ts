/* Starward server — dashboard view resolver
 *
 * Narrow per-page aggregate for DashboardPage. Composes goals, today's
 * daily log + tasks, pending tasks, chat messages, active nudges,
 * vacation mode, and the current monthly context into ONE
 * serialization-ready object the client can render without any
 * post-processing.
 */

import * as repos from "../repositories";
import { getEffectiveDate, getEffectiveMonthKey } from "../dateUtils";
import type {
  ContextualNudge,
  DailyTask,
  HomeChatMessage,
  MonthlyContext,
  PendingTask,
  Reminder,
} from "@starward/core";
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
}

export interface DashboardView {
  todayDate: string;
  greetingName: string;
  todaySummary: DashboardTodaySummary;
  todayTasks: DailyTask[];
  pendingTasks: PendingTask[];
  /** Subset of pendingTasks still in an actionable state. */
  activePendingTasks: PendingTask[];
  /** Aggregate overload signals derived from todayTasks. */
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
    todayTaskRecords,
    pendingRecords,
    homeMessages,
    activeReminders,
    nudgeRecords,
    vacationState,
    monthlyContexts,
    user,
  ] = await Promise.all([
    repos.dailyTasks.listForDate(today),
    repos.pendingTasks.list(),
    repos.chat.listHomeMessages(200),
    repos.reminders.listActive(),
    repos.nudges.list(true),
    repos.vacationMode.get(),
    repos.monthlyContext.list(),
    repos.users.get(),
  ]);

  const greetingName = user?.name?.trim() || "";

  const todayTasks: DailyTask[] = todayTaskRecords.map((r) => flattenDailyTask(r));
  const recentNudges: ContextualNudge[] = nudgeRecords.map(nudgeToContextual);

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

  const activePendingTasks = pendingTasks.filter(
    (pt) => pt.status === "analyzing" || pt.status === "ready",
  );

  const dailyLoad: DashboardDailyLoad = {
    currentWeight: todayTasks.reduce((sum, t) => sum + (t.cognitiveWeight ?? 3), 0),
    currentMinutes: todayTasks.reduce((sum, t) => sum + (t.durationMinutes ?? 30), 0),
    activeTaskCount: todayTasks.filter((t) => !t.completed).length,
  };

  const completedTasks = todayTasks.filter((t) => t.completed).length;
  const totalTasks = todayTasks.length;

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
    todayTasks,
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
