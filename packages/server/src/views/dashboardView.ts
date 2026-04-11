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
import { query } from "../db/pool";
import { requireUserId } from "../repositories/_context";
import type {
  CalendarEvent,
  Goal,
  HomeChatMessage,
  MonthlyContext,
  PendingTask,
  Reminder,
} from "@northstar/core";
import type { DailyTaskRecord } from "../repositories/dailyTasksRepo";
import type { NudgeRecord } from "../repositories/nudgesRepo";

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

export interface DashboardView {
  todayDate: string;
  greetingName: string;
  todaySummary: DashboardTodaySummary;
  activeGoals: Goal[];
  todayTasks: DailyTaskRecord[];
  todayEvents: CalendarEvent[];
  pendingTasks: PendingTask[];
  homeChatMessages: HomeChatMessage[];
  activeReminders: Reminder[];
  recentNudges: NudgeRecord[];
  vacationMode: DashboardVacationMode;
  currentMonthContext: MonthlyContext | null;
  /** True when the user has not yet set a context for the current
   *  calendar month — DashboardPage uses this to show the month nudge. */
  needsMonthlyContext: boolean;
}

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function currentMonthKey(): string {
  // MonthlyContext.month is stored as "YYYY-MM".
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Read a single top-level key from the legacy app_store row. We need this
 *  until Phase 6 moves user/settings and vacationMode onto their own
 *  tables. Do not export — view resolvers are the only caller and should
 *  comment each call with a TODO. */
async function readAppStoreKey<T>(key: string): Promise<T | null> {
  const userId = requireUserId();
  const rows = await query<{ value: T }>(
    `select value from app_store where user_id = $1 and key = $2`,
    [userId, key],
  );
  return rows.length > 0 ? (rows[0].value as T) : null;
}

export async function resolveDashboardView(): Promise<DashboardView> {
  const today = todayISO();

  // ── Fire the independent repo reads in parallel ─────────────
  const [
    goals,
    todayTasks,
    todayEvents,
    pendingRecords,
    homeMessages,
    activeReminders,
    nudges,
    vacationState,
    monthlyContexts,
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
  ]);

  // TODO(phase6): move user profile (name, settings) to a dedicated users
  // table — for now the client's greetingName still lives in app_store.user.
  const userRow = await readAppStoreKey<{ name?: string }>("user");
  const greetingName = userRow?.name?.trim() || "";

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

  const monthKey = currentMonthKey();
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
    homeChatMessages: homeMessages,
    activeReminders,
    recentNudges: nudges,
    vacationMode,
    currentMonthContext,
    needsMonthlyContext: currentMonthContext === null,
  };
}
