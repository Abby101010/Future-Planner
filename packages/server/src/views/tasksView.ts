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
import { getEffectiveDate, getEffectiveDaysAgo } from "../dateUtils";
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
import { generateAndPersistDailyTasks } from "../services/dailyTaskGeneration";
import { detectPaceMismatches, type PaceMismatch } from "../services/paceDetection";
import { loadMemory, computeCapacityProfile } from "../memory";
import { getCurrentUserId } from "../middleware/requestContext";

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
  /** Active big goals where the user's pace is behind the plan. */
  paceMismatches: PaceMismatch[];
  /** True on Sunday/Monday if user hasn't done a weekly review this week. */
  weeklyReviewDue: boolean;
}

/** Try to extract a date range from a week label like "Jan 6 – Jan 12"
 *  or "Apr 6 - Apr 12". Returns [startISO, endISO] or null. */
function parseWeekLabelRange(
  weekLabel: string,
  referenceYear: number,
): [string, string] | null {
  // Match patterns: "Jan 6 – Jan 12", "Apr 6 - Apr 12", "January 6 – January 12"
  const m = weekLabel.match(
    /([A-Za-z]+)\s+(\d{1,2})\s*[–\-]\s*([A-Za-z]+)\s+(\d{1,2})/,
  );
  if (!m) return null;
  const parse = (mon: string, day: string): string | null => {
    // Try with reference year first, then next year for Dec→Jan wraps
    for (const yr of [referenceYear, referenceYear + 1]) {
      const d = new Date(`${mon} ${day}, ${yr}`);
      if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    }
    return null;
  };
  const start = parse(m[1], m[2]);
  const end = parse(m[3], m[4]);
  if (!start || !end) return null;
  return [start, end];
}

/** Check whether `today` falls within the parent week's date range.
 *  Returns true (inside), false (outside), or null (can't determine). */
function todayInWeek(weekLabel: string, today: string): boolean | null {
  const yr = new Date(`${today}T00:00:00`).getFullYear();
  const range = parseWeekLabelRange(weekLabel, yr);
  if (!range) return null; // label is "Week 1" etc. — can't tell
  return today >= range[0] && today <= range[1];
}

/** Plan generators emit day labels in several shapes ("Monday", "Mon",
 *  "Jan 6", "2026-04-11", etc.). Match against today leniently so the
 *  page surfaces plan tasks regardless of generator style.
 *  `weekLabel` is the parent GoalPlanWeek.label — when it contains a
 *  date range (e.g. "Jan 6 – Jan 12") we use it to avoid matching a
 *  "Monday" in a different week. */
function dayMatchesToday(
  rawLabel: string,
  today: string,
  weekLabel?: string,
): boolean {
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

  // Exact ISO date match — always unambiguous
  if (label === today || label.includes(today)) return true;
  // Month+day match (e.g. "Jan 6", "Apr 11") — also unambiguous within a year
  if (label === monthDay || label.includes(monthDay)) return true;
  if (label === monthDayPadded || label.includes(monthDayPadded)) return true;

  // Weekday-only labels ("Monday", "Mon") are AMBIGUOUS — the same name
  // repeats every week. Use the parent week's date range to disambiguate.
  const isWeekdayMatch =
    label === weekdayLong ||
    label === weekdayShort ||
    label.startsWith(`${weekdayShort} `);
  if (isWeekdayMatch) {
    if (weekLabel) {
      const inWeek = todayInWeek(weekLabel, today);
      if (inWeek === true) return true;
      if (inWeek === false) return false;
    }
    // No week range available — weekday names are ambiguous, skip.
    return false;
  }

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
  // Goals already represented in the daily log — the AI already
  // considered them and made its selection. Don't show their remaining
  // plan tasks as "pending" since that bypasses the cognitive budget.
  const representedGoalIds = new Set<string>(
    (todayLog?.tasks ?? [])
      .map((t) => t.goalId ?? "")
      .filter(Boolean),
  );
  const out: PendingGoalTask[] = [];
  for (const g of goals) {
    if (!g.plan || !Array.isArray(g.plan.years)) continue;
    if (representedGoalIds.has(g.id)) continue;
    for (const year of g.plan.years) {
      for (const month of year.months) {
        for (const week of month.weeks) {
          if (week.locked) continue;
          for (const day of week.days) {
            if (!dayMatchesToday(day.label, today, week.label)) continue;
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

function computeTodayProgress(
  todayLog: DailyLog | null,
  pendingGoalTasks: PendingGoalTask[],
): TodayProgressSummary {
  const logTasks = todayLog?.tasks ?? [];
  const pendingCompleted = pendingGoalTasks.filter((t) => t.completed).length;
  const completed = logTasks.filter((t) => t.completed).length + pendingCompleted;
  const total = logTasks.length + pendingGoalTasks.length;
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
  const today = getEffectiveDate();
  const rangeStart = getEffectiveDaysAgo(90);

  const [
    goals,
    logs,
    tasksInRange,
    heatmapData,
    activeReminders,
    todayEvents,
    nudges,
    vacationState,
    userProfile,
  ] = await Promise.all([
    repos.goals.list(),
    repos.dailyLogs.list(rangeStart, today),
    repos.dailyTasks.listForDateRange(rangeStart, today),
    repos.heatmap.listRange(rangeStart, today),
    repos.reminders.listActive(),
    repos.calendar.listForRange(`${today}T00:00:00`, `${today}T23:59:59`),
    repos.nudges.list(true),
    repos.vacationMode.get(),
    repos.users.get(),
  ]);

  // Group tasks by date for cheap hydration.
  const tasksByDate = new Map<string, DailyTaskRecord[]>();
  for (const t of tasksInRange) {
    const arr = tasksByDate.get(t.date) ?? [];
    arr.push(t);
    tasksByDate.set(t.date, arr);
  }

  let hydratedLogs: DailyLog[] = logs
    .map((log) => hydrateDailyLog(log, tasksByDate.get(log.date) ?? []))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  let todayLog = hydratedLogs.find((l) => l.date === today) ?? null;

  // Auto-generate daily tasks if: no log for today, goals exist,
  // and the current time is past the user's dailyTaskRefreshTime.
  if (!todayLog && goals.length > 0) {
    const refreshTime = userProfile?.settings?.dailyTaskRefreshTime ?? "06:00";
    const now = new Date();
    const [rh, rm] = refreshTime.split(":").map(Number);
    const refreshMinutes = (rh || 0) * 60 + (rm || 0);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (nowMinutes >= refreshMinutes) {
      try {
        await generateAndPersistDailyTasks({
          date: today,
          goals,
          calendarEvents: todayEvents,
          pastLogs: hydratedLogs.slice(0, 14),
          heatmapData,
          activeReminders,
        });
        // Re-fetch the newly created tasks and log so this response
        // includes them (avoids requiring a second round-trip).
        const freshTasks = await repos.dailyTasks.listForDateRange(today, today);
        const freshLogs = await repos.dailyLogs.list(today, today);
        // Replace (not append) today's tasks to avoid duplicates when
        // the initial tasksInRange already contained rows for today.
        tasksByDate.set(today, freshTasks);
        if (freshLogs.length > 0) {
          const freshLog = hydrateDailyLog(freshLogs[0], tasksByDate.get(today) ?? []);
          hydratedLogs = [freshLog, ...hydratedLogs];
          todayLog = freshLog;
        }
      } catch (err) {
        console.warn("[tasksView] auto-generation failed:", err);
      }
    }
  }

  const todayDow = new Date(today + "T00:00:00").getDay();
  const todayDom = new Date(today + "T00:00:00").getDate();
  const todayReminders = activeReminders
    .filter((r) => {
      if (r.date === today) return true;
      if (r.repeat === "daily") return true;
      if (r.repeat === "weekly") {
        const rDow = new Date(r.date + "T00:00:00").getDay();
        return rDow === todayDow;
      }
      if (r.repeat === "monthly") {
        const rDom = new Date(r.date + "T00:00:00").getDate();
        return rDom === todayDom;
      }
      return false;
    })
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

  let pendingGoalTasks = computePendingGoalTasks(goals, todayLog, today);

  console.debug(
    `[tasksView] ${pendingGoalTasks.length} pending goal tasks, ` +
    `todayLog has ${todayLog?.tasks.length ?? 0} tasks`,
  );

  const todayProgress = computeTodayProgress(todayLog, pendingGoalTasks);
  const todayMissedTasks = [
    ...(todayLog?.tasks ?? []).filter((t) => !t.completed),
    ...pendingGoalTasks.filter((t) => !t.completed),
  ];

  // Pace mismatch detection: compare user's actual task rate against plan assumptions
  let paceMismatches: PaceMismatch[] = [];
  try {
    const userId = getCurrentUserId();
    const memory = await loadMemory(userId);
    const logsForCapacity = hydratedLogs.map((l) => ({
      date: l.date,
      tasks: l.tasks.map((t) => ({ completed: t.completed, skipped: !!t.skipped })),
    }));
    const capacity = computeCapacityProfile(memory, logsForCapacity, new Date(today + "T00:00:00").getDay());
    paceMismatches = detectPaceMismatches(goals, capacity.avgTasksCompletedPerDay, today);

    // Insert pace_warning nudges for severe mismatches (deduped per goal per week)
    const weekNum = Math.floor(new Date(today + "T00:00:00").getTime() / (7 * 86400000));
    for (const m of paceMismatches.filter((p) => p.severity === "severe")) {
      try {
        await repos.nudges.insert({
          id: `pace-${m.goalId}-w${weekNum}`,
          kind: "pace_warning",
          title: `Falling behind on ${m.goalTitle}`,
          body: `At your current pace (~${m.actualTasksPerDay} tasks/day), you'll miss the target by ~${m.estimatedDelayDays} days.`,
          priority: 8,
          context: m.goalId,
          actions: [
            { label: "Adjust Plan", feedbackValue: "reschedule", isPositive: true },
            { label: "Dismiss", feedbackValue: "dismiss", isPositive: false },
          ],
        });
      } catch {
        // nudge insertion is best-effort
      }
    }
  } catch {
    // pace detection is best-effort
  }

  // Weekly review is due on Sunday (0) or Monday (1) and hasn't been done this week.
  // We check memory for last_weekly_review timestamp.
  const todayDowForReview = new Date(today + "T00:00:00").getDay();
  const isReviewDay = todayDowForReview === 0 || todayDowForReview === 1;
  const userId = getCurrentUserId();
  let weeklyReviewDue = false;
  if (isReviewDay) {
    try {
      const mem = await loadMemory(userId);
      const lastReview = (mem as unknown as Record<string, unknown>).lastWeeklyReview as string | undefined;
      const weekStart = new Date(today + "T00:00:00");
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekKey = weekStart.toISOString().split("T")[0];
      weeklyReviewDue = !lastReview || lastReview < weekKey;
    } catch {
      weeklyReviewDue = false;
    }
  }

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
    paceMismatches,
    weeklyReviewDue,
  };
}
