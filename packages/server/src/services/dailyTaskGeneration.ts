/* NorthStar — shared daily-task generation + persistence
 *
 * Extracted from the POST /ai/daily-tasks route so it can be called
 * both from the HTTP handler (manual refresh) and from resolveTasksView
 * (on-demand auto-generation when the page loads and no log exists).
 */

import * as repos from "../repositories";
import { handleAIRequest } from "../ai/router";
import { loadMemory, buildMemoryContext } from "../memory";
import { getCurrentUserId } from "../middleware/requestContext";
import { getEffectiveDate } from "../dateUtils";
import { needsCoordination } from "../agents/router";
import { coordinateRequest } from "../agents/coordinator";
import { COGNITIVE_BUDGET } from "@northstar/core";
import type { Goal, CalendarEvent, DailyLog, HeatmapEntry, Reminder, TaskStateInput, GoalSummary, CalendarEventSummary, DailyLogSummary } from "@northstar/core";

interface GeneratedResult {
  id?: string;
  date: string;
  tasks: Array<{
    id: string;
    title: string;
    description?: string;
    durationMinutes?: number;
    cognitiveWeight?: number;
    whyToday?: string;
    priority?: string;
    isMomentumTask?: boolean;
    progressContribution?: string;
    category?: string;
    completed?: boolean;
    goalId?: string | null;
    planNodeId?: string | null;
  }>;
  heatmapEntry?: {
    date: string;
    completionLevel: 0 | 1 | 2 | 3 | 4;
    currentStreak: number;
    totalActiveDays: number;
    longestStreak: number;
  };
  notificationBriefing?: string;
  adaptiveReasoning?: string;
  milestoneCelebration?: unknown;
  progress?: unknown;
  yesterdayRecap?: unknown;
  encouragement?: string;
}

function computeGoalLastTouched(
  pastLogs: DailyLog[],
  goals: Goal[],
  today: string,
): Record<string, { lastDate: string | null; daysSince: number }> {
  const result: Record<string, { lastDate: string | null; daysSince: number }> = {};
  const todayMs = new Date(today + "T00:00:00").getTime();

  for (const g of goals) {
    let lastDate: string | null = null;
    for (const log of pastLogs) {
      const worked = (log.tasks ?? []).some((t) => t.goalId === g.id && t.completed);
      if (worked) {
        if (!lastDate || log.date > lastDate) lastDate = log.date;
      }
    }
    const daysSince = lastDate
      ? Math.max(0, Math.round((todayMs - new Date(lastDate + "T00:00:00").getTime()) / 86400000))
      : 999;
    result[g.id] = { lastDate, daysSince };
  }
  return result;
}

function filterTodayReminders(active: Reminder[], targetDate: string): Reminder[] {
  const todayDow = new Date(targetDate + "T00:00:00").getDay();
  const todayDom = new Date(targetDate + "T00:00:00").getDate();
  return active.filter((r) => {
    if (r.date === targetDate) return true;
    if (r.repeat === "daily") return true;
    if (r.repeat === "weekly") {
      return new Date(r.date + "T00:00:00").getDay() === todayDow;
    }
    if (r.repeat === "monthly") {
      return new Date(r.date + "T00:00:00").getDate() === todayDom;
    }
    return false;
  });
}

/** Build goal-plan summaries for today (server-side equivalent of the
 *  client's generateDailyTasks goal scanning). */
function buildGoalPlanSummaries(goals: Goal[], date: string) {
  const d = new Date(date + "T00:00:00");
  const todayWeekdayLong = d.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  const todayWeekdayShort = d.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
  const todayMonthDay = d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toLowerCase();

  const parseWeekRange = (weekLabel: string): [string, string] | null => {
    const m = weekLabel.match(
      /([A-Za-z]+)\s+(\d{1,2})\s*[–\-]\s*([A-Za-z]+)\s+(\d{1,2})/,
    );
    if (!m) return null;
    const yr = d.getFullYear();
    const parse = (mon: string, dy: string): string | null => {
      for (const y of [yr, yr + 1]) {
        const dt = new Date(`${mon} ${dy}, ${y}`);
        if (!isNaN(dt.getTime())) return dt.toISOString().split("T")[0];
      }
      return null;
    };
    const s = parse(m[1], m[2]);
    const e = parse(m[3], m[4]);
    return s && e ? [s, e] : null;
  };

  const dayMatchesToday = (rawLabel: string, weekLabel?: string): boolean => {
    const label = rawLabel.toLowerCase().trim();
    if (!label) return false;
    if (label === date || label.includes(date)) return true;
    if (label === todayMonthDay || label.includes(todayMonthDay)) return true;
    const isWeekdayMatch =
      label === todayWeekdayLong || label === todayWeekdayShort || label.startsWith(`${todayWeekdayShort} `);
    if (isWeekdayMatch && weekLabel) {
      const range = parseWeekRange(weekLabel);
      if (range) return date >= range[0] && date <= range[1];
    }
    return false;
  };

  return goals
    .filter((g) => g.goalType === "big" || (!g.goalType && g.scope === "big"))
    .map((g) => {
      const todayTasks: Array<{
        goalId: string;
        planNodeId: string;
        title: string;
        description: string;
        durationMinutes: number;
        priority: string;
        category: string;
      }> = [];
      if (g.plan && Array.isArray(g.plan.years)) {
        for (const year of g.plan.years) {
          for (const month of year.months) {
            for (const week of month.weeks) {
              if (week.locked) continue;
              for (const day of week.days) {
                if (!dayMatchesToday(day.label, week.label)) continue;
                for (const t of day.tasks) {
                  if (t.completed) continue;
                  todayTasks.push({
                    goalId: g.id,
                    planNodeId: t.id,
                    title: t.title,
                    description: t.description,
                    durationMinutes: t.durationMinutes,
                    priority: t.priority,
                    category: t.category,
                  });
                }
              }
            }
          }
        }
      }
      return {
        goalId: g.id,
        goalTitle: g.title,
        scope: g.scope,
        goalType: g.goalType || "big",
        status: g.status,
        todayTasks,
      };
    })
    .filter((g) => g.todayTasks.length > 0);
}

/** Generate daily tasks via the AI handler and persist the result. */
export async function generateAndPersistDailyTasks(opts: {
  date?: string;
  goals?: Goal[];
  calendarEvents?: CalendarEvent[];
  pastLogs?: DailyLog[];
  heatmapData?: HeatmapEntry[];
  activeReminders?: Reminder[];
}): Promise<GeneratedResult> {
  const date = opts.date ?? getEffectiveDate();
  const goals = opts.goals ?? [];
  const calendarEvents = opts.calendarEvents ?? [];
  const pastLogs = opts.pastLogs ?? [];

  const todayReminders = opts.activeReminders
    ? filterTodayReminders(opts.activeReminders, date)
    : [];

  const activeGoals = goals.filter(
    (g) => g.status !== "archived" && g.status !== "completed",
  );

  const goalPlanSummaries = buildGoalPlanSummaries(activeGoals, date);

  const todayDow = new Date(date + "T00:00:00").getDay();
  const everydayGoals = activeGoals
    .filter((g) => (g.goalType === "everyday" || (!g.goalType && g.scope === "small")) && g.status !== "completed" && g.status !== "archived")
    .map((g) => ({
      title: g.title,
      description: g.description,
      suggestedTimeSlot: g.suggestedTimeSlot || null,
      tasks: (g.flatPlan?.flatMap((s) => s.tasks) || [])
        .filter((t) => !t.completed)
        .map((t) => ({ title: t.title, description: t.description, durationMinutes: t.durationMinutes, priority: t.priority, category: t.category })),
    }))
    .filter((g) => g.tasks.length > 0);

  const repeatingGoals = activeGoals
    .filter((g) => g.goalType === "repeating" && g.status !== "archived" && g.repeatSchedule)
    .filter((g) => g.repeatSchedule!.daysOfWeek.includes(todayDow))
    .map((g) => ({
      title: g.title,
      timeOfDay: g.repeatSchedule!.timeOfDay || null,
      durationMinutes: g.repeatSchedule!.durationMinutes,
      frequency: g.repeatSchedule!.frequency,
    }));

  const todayCalendarEvents = calendarEvents.map((e) => ({
    title: e.title,
    startDate: e.startDate,
    endDate: e.endDate,
    durationMinutes: e.durationMinutes,
    category: e.category,
    isAllDay: e.isAllDay,
    recurring: e.recurring,
  }));

  const userId = getCurrentUserId();
  const memory = await loadMemory(userId);
  const memoryContext = buildMemoryContext(memory, "daily");

  const payload: Record<string, unknown> = {
    date,
    pastLogs,
    heatmap: opts.heatmapData ?? [],
    inAppEvents: calendarEvents,
    goalPlanSummaries,
    everydayGoals,
    repeatingGoals,
    todayCalendarEvents,
    todayReminders,
    goals: activeGoals.map((g) => ({
      title: g.title,
      goalType: g.goalType,
      scope: g.scope,
      status: g.status,
      targetDate: g.targetDate,
    })),
    confirmedQuickTasks: [],
    isVacationDay: false,
  };

  // Run coordinator pipeline when agents are needed (daily-tasks → gatekeeper + timeEstimator + scheduler)
  let coordinatorState;
  if (needsCoordination("daily-tasks")) {
    const goalLastTouched = computeGoalLastTouched(pastLogs, activeGoals, date);

    const goalSummaries: GoalSummary[] = goalPlanSummaries.map((gps) => ({
      id: gps.goalId,
      title: gps.goalTitle,
      goalType: gps.goalType,
      status: gps.status,
      targetDate: activeGoals.find((g) => g.id === gps.goalId)?.targetDate ?? null,
      lastTouchedDate: goalLastTouched[gps.goalId]?.lastDate ?? null,
      daysSinceLastWorked: goalLastTouched[gps.goalId]?.daysSince ?? 999,
      planTasksToday: gps.todayTasks.map((t) => ({
        id: t.planNodeId,
        title: t.title,
        description: t.description,
        durationMinutes: t.durationMinutes,
        priority: t.priority,
        category: t.category,
        goalId: t.goalId,
        goalTitle: gps.goalTitle,
        planNodeId: t.planNodeId,
      })),
    }));

    const calendarSummaries: CalendarEventSummary[] = calendarEvents.map((e) => ({
      id: e.id,
      title: e.title,
      startDate: e.startDate,
      endDate: e.endDate,
      category: e.category ?? "",
      isAllDay: e.isAllDay ?? false,
    }));

    const logSummaries: DailyLogSummary[] = pastLogs.slice(0, 7).map((l) => ({
      date: l.date,
      tasksCompleted: l.tasks?.filter((t) => t.completed).length ?? 0,
      tasksTotal: l.tasks?.length ?? 0,
      goalIdsWorked: [...new Set((l.tasks ?? []).map((t) => t.goalId).filter(Boolean) as string[])],
    }));

    const recentLogs = pastLogs.slice(0, 7);
    const recentCompletionRate = recentLogs.length > 0
      ? Math.round(
          (recentLogs.reduce((s, l) => s + (l.tasks?.filter((t) => t.completed).length ?? 0), 0) /
            Math.max(1, recentLogs.reduce((s, l) => s + (l.tasks?.length ?? 0), 0))) *
            100,
        )
      : -1;

    const taskStateInput: TaskStateInput = {
      date,
      goals: goalSummaries,
      calendarEvents: calendarSummaries,
      pastLogs: logSummaries,
      memoryContext,
      capacityBudget: COGNITIVE_BUDGET.MAX_DAILY_WEIGHT,
      recentCompletionRate,
    };

    coordinatorState = await coordinateRequest("daily-tasks", taskStateInput);
  }

  const result = (await handleAIRequest("daily-tasks", payload, memoryContext, coordinatorState)) as GeneratedResult;

  // Persist
  await repos.dailyTasks.removeForDate(date);
  for (let i = 0; i < result.tasks.length; i++) {
    const t = result.tasks[i];
    await repos.dailyTasks.insert({
      id: t.id,
      date,
      title: t.title,
      completed: t.completed ?? false,
      orderIndex: i,
      goalId: t.goalId ?? null,
      planNodeId: t.planNodeId ?? null,
      payload: {
        description: t.description,
        durationMinutes: t.durationMinutes,
        cognitiveWeight: t.cognitiveWeight,
        whyToday: t.whyToday,
        priority: t.priority,
        isMomentumTask: t.isMomentumTask,
        progressContribution: t.progressContribution,
        category: t.category,
      },
    });
  }

  await repos.dailyLogs.upsert({
    date,
    payload: {
      id: result.id ?? `log-${date}`,
      notificationBriefing: result.notificationBriefing ?? "",
      adaptiveReasoning: result.adaptiveReasoning ?? "",
      milestoneCelebration: result.milestoneCelebration ?? null,
      progress: result.progress ?? null,
      yesterdayRecap: result.yesterdayRecap ?? null,
      encouragement: result.encouragement ?? "",
      heatmapEntry: result.heatmapEntry ?? null,
    },
  });

  if (result.heatmapEntry) {
    await repos.heatmap.upsert(result.heatmapEntry);
  }

  return result;
}
