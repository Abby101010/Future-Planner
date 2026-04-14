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
  ContextualNudge,
  DailyLog,
  DailyTask,
  Goal,
  HeatmapEntry,
  Reminder,
} from "@northstar/core";
import type { DailyTaskRecord } from "../repositories/dailyTasksRepo";
import { hydrateDailyLog, nudgeToContextual } from "./_mappers";
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

/** A task from a past day that was never completed — candidate for
 *  the reschedule confirmation card. */
export interface PendingReschedule {
  taskId: string;
  title: string;
  description?: string;
  originalDate: string;
  cognitiveWeight: number;
  durationMinutes: number;
  goalId: string | null;
  goalTitle?: string;
  /** Number of times this task has already been rescheduled. */
  rescheduleCount: number;
  /** Server-recommended date to move this task to (lightest upcoming day). */
  suggestedDate: string;
  /** Human-friendly label like "Tomorrow" or "Wed, Apr 15". */
  suggestedDateLabel: string;
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
  /** One-time reminders from past dates that were never acknowledged. */
  overdueReminders: Reminder[];
  recentNudges: ContextualNudge[];
  vacationMode: TasksVacationMode;
  totalIncompleteTasks: number;
  /** Derived: completed/total/ratePercent over today's log. */
  todayProgress: TodayProgressSummary;
  /** Derived: goal-plan tasks scheduled for today that the daily-tasks
   *  LLM hasn't yet pulled into today's log. */
  pendingGoalTasks: PendingGoalTask[];
  /** Incomplete tasks from past days awaiting user reschedule decision. */
  pendingReschedules: PendingReschedule[];
  /** Active big goals where the user's pace is behind the plan. */
  paceMismatches: PaceMismatch[];
  /** True on Sunday/Monday if user hasn't done a weekly review this week. */
  weeklyReviewDue: boolean;
  /** True when all today's tasks are completed or skipped (for bonus task prompt). */
  allTasksCompleted: boolean;
  /** Goals with too many overdue tasks — triggers the overload banner. */
  overloadedGoals: OverloadedGoalSummary[];
  /** True when the user has at least one active goal. */
  hasGoals: boolean;
  /** True when today already has a plan (log exists with tasks). */
  hasTodayPlan: boolean;
  /** Number of tasks in the pending pool awaiting integration on refresh. */
  pooledTaskCount: number;
}

export interface OverloadedGoalSummary {
  goalId: string;
  goalTitle: string;
  overdueCount: number;
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
  if (!rawLabel) return false;
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

/** A plan-tree task from a day BEFORE today that was never completed
 *  and never materialized as a daily_task. Needs to be converted to a
 *  reschedule candidate. */
interface OverduePlanTask {
  planNodeId: string;
  title: string;
  description?: string;
  goalId: string;
  goalTitle: string;
  durationMinutes: number;
  cognitiveWeight: number;
  /** How many day-slots before today's slot in the week. */
  daysBeforeToday: number;
}

interface PendingGoalTasksResult {
  todayTasks: PendingGoalTask[];
  overduePlanTasks: OverduePlanTask[];
}

function computePendingGoalTasks(
  goals: Goal[],
  todayLog: DailyLog | null,
  today: string,
  /** Plan node keys already in daily_tasks (goalId:planNodeId). */
  existingPlanNodeKeys: Set<string>,
): PendingGoalTasksResult {
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
  const todayTasks: PendingGoalTask[] = [];
  const overduePlanTasks: OverduePlanTask[] = [];

  for (const g of goals) {
    if (!g.plan || !Array.isArray(g.plan.years)) continue;
    if (representedGoalIds.has(g.id)) continue;
    for (const year of g.plan.years) {
      for (const month of year.months) {
        for (const week of month.weeks) {
          if (week.locked) continue;

          // Find which day index matches today within this week.
          let todayIdx = -1;
          for (let i = 0; i < week.days.length; i++) {
            if (dayMatchesToday(week.days[i].label, today, week.label)) {
              todayIdx = i;
              break;
            }
          }
          if (todayIdx < 0) continue;

          // Collect incomplete tasks from days BEFORE today that
          // don't already have daily_task rows.
          let hasPriorIncomplete = false;
          for (let i = 0; i < todayIdx; i++) {
            for (const tk of week.days[i].tasks) {
              if (tk.completed) continue;
              hasPriorIncomplete = true;
              const key = `${g.id}:${tk.id}`;
              if (!existingPlanNodeKeys.has(key) && !consumed.has(tk.id)) {
                const extra = tk as unknown as Record<string, unknown>;
                overduePlanTasks.push({
                  planNodeId: tk.id,
                  title: tk.title ?? "",
                  description: tk.description,
                  goalId: g.id,
                  goalTitle: g.title,
                  durationMinutes: tk.durationMinutes ?? 30,
                  cognitiveWeight: (extra.cognitiveWeight as number) ?? 3,
                  daysBeforeToday: todayIdx - i,
                });
              }
            }
          }

          // Block today's tasks if earlier days have incomplete tasks.
          if (hasPriorIncomplete) continue;

          const day = week.days[todayIdx];
          for (const tk of day.tasks) {
            if (tk.completed) continue;
            if (consumed.has(tk.id)) continue;
            todayTasks.push({
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
  return { todayTasks, overduePlanTasks };
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
    nudges,
    vacationState,
    pendingRescheduleRaw,
    pooledTaskCount,
  ] = await Promise.all([
    repos.goals.list(),
    repos.dailyLogs.list(rangeStart, today),
    repos.dailyTasks.listForDateRange(rangeStart, today),
    repos.heatmap.listRange(rangeStart, today),
    repos.reminders.listActive(),
    repos.nudges.list(true),
    repos.vacationMode.get(),
    repos.dailyTasks.listPendingReschedule(today),
    repos.pendingTasks.countPooledForDate(today),
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

  const todayLog = hydratedLogs.find((l) => l.date === today) ?? null;

  // No auto-generation — the user must click Refresh to generate tasks.
  // The TasksPage shows an empty state with a Refresh button when no
  // tasks exist for today.

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

  // One-time reminders from past dates that were never acknowledged.
  const overdueReminders = activeReminders
    .filter((r) => r.repeat === null && !r.acknowledged && r.date < today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.reminderTime.localeCompare(b.reminderTime));

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

  // Build a set of (goalId:planNodeId) keys already in daily_tasks
  // so we don't create duplicate rows for plan tasks.
  const existingPlanNodeKeys = new Set<string>();
  for (const t of tasksInRange) {
    if (t.planNodeId && t.goalId) {
      existingPlanNodeKeys.add(`${t.goalId}:${t.planNodeId}`);
    }
  }

  const pgResult = computePendingGoalTasks(
    goals, todayLog, today, existingPlanNodeKeys,
  );

  // Plan-tree tasks are NOT shown directly in "Today". The AI daily
  // task generation is the sole source for today's task list. Plan
  // tasks from prior days get materialized as reschedule candidates
  // below; today's plan tasks are simply not surfaced.
  const pendingGoalTasks: PendingGoalTask[] = [];

  // Materialize overdue plan-tree tasks as daily_task rows so they
  // appear in the reschedule section. This is a one-time side effect
  // — subsequent loads find the rows already exist.
  const materializedReschedules: Omit<PendingReschedule, "suggestedDate" | "suggestedDateLabel">[] = [];
  for (const ot of pgResult.overduePlanTasks) {
    const origDate = new Date(`${today}T12:00:00`);
    origDate.setDate(origDate.getDate() - ot.daysBeforeToday);
    const origDateStr = origDate.toISOString().split("T")[0];
    const taskId = `plan-${ot.goalId.slice(0, 8)}-${ot.planNodeId}`;

    try {
      await repos.dailyTasks.insert({
        id: taskId,
        date: origDateStr,
        goalId: ot.goalId,
        planNodeId: ot.planNodeId,
        title: ot.title,
        completed: false,
        orderIndex: 0,
        source: "big_goal",
        payload: {
          description: ot.description ?? "",
          durationMinutes: ot.durationMinutes,
          cognitiveWeight: ot.cognitiveWeight,
          source: "plan-materialized",
          category: "planning",
        },
      });
      // Add directly to this response's reschedule list.
      materializedReschedules.push({
        taskId,
        title: ot.title,
        description: ot.description,
        originalDate: origDateStr,
        cognitiveWeight: ot.cognitiveWeight,
        durationMinutes: ot.durationMinutes,
        goalId: ot.goalId,
        goalTitle: ot.goalTitle,
        rescheduleCount: 0,
      });
    } catch {
      // Already exists (duplicate key) — safe to ignore
    }
  }

  console.debug(
    `[tasksView] ${pendingGoalTasks.length} pending goal tasks, ` +
    `${pgResult.overduePlanTasks.length} overdue plan tasks materialized, ` +
    `todayLog has ${todayLog?.tasks.length ?? 0} tasks`,
  );

  const todayProgress = computeTodayProgress(todayLog, pendingGoalTasks);

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

  // All tasks completed — triggers bonus task prompt on the client.
  const todayTasks = todayLog?.tasks ?? [];
  const allTasksCompleted =
    todayTasks.length > 0 &&
    todayTasks.every((t) => t.completed || t.skipped);

  // Pending reschedules: incomplete tasks from past days that need
  // user confirmation on where to move them. No "overdue" concept —
  // just a confirmation card asking the user to pick a new day.
  // (pendingRescheduleRaw was fetched in the initial parallel batch.)
  const pendingRescheduleRecords = pendingRescheduleRaw;
  const goalMap = new Map(goals.map((g) => [g.id, g.title]));

  // Compute suggested reschedule dates by looking at cognitive load for
  // each of the next 7 days. We recommend the day with the lightest load
  // (tomorrow is preferred when loads are tied).
  const futureDates: string[] = [];
  for (let i = 1; i <= 7; i++) {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() + i);
    futureDates.push(d.toISOString().split("T")[0]);
  }
  let futureTasks: DailyTaskRecord[] = [];
  try {
    futureTasks = await repos.dailyTasks.listForDateRange(
      futureDates[0],
      futureDates[futureDates.length - 1],
    );
  } catch { /* best-effort */ }
  const loadByDate = new Map<string, number>();
  for (const ft of futureTasks) {
    const cw = (ft.payload.cognitiveWeight as number) ?? 3;
    loadByDate.set(ft.date, (loadByDate.get(ft.date) ?? 0) + cw);
  }
  // Also count today's load so we can potentially suggest today if very light
  const todayCogLoad = (todayLog?.tasks ?? []).reduce(
    (s, t) => s + (t.completed || t.skipped ? 0 : ((t as unknown as Record<string, unknown>).cognitiveWeight as number ?? 3)),
    0,
  );

  function pickSuggestedDate(taskCogWeight: number): string {
    // Find the lightest day among the next 7 days
    let bestDate = futureDates[0]; // default: tomorrow
    let bestLoad = loadByDate.get(futureDates[0]) ?? 0;
    for (const fd of futureDates) {
      const load = loadByDate.get(fd) ?? 0;
      if (load < bestLoad) {
        bestLoad = load;
        bestDate = fd;
      }
    }
    return bestDate;
  }

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function formatSuggestedLabel(dateStr: string): string {
    const tomorrow = futureDates[0];
    if (dateStr === tomorrow) return "Tomorrow";
    const d = new Date(dateStr + "T12:00:00");
    return `${dayNames[d.getDay()]}, ${monthNames[d.getMonth()]} ${d.getDate()}`;
  }

  const pendingReschedules: PendingReschedule[] = [
    ...pendingRescheduleRecords.map((t) => {
      const cw = (t.payload.cognitiveWeight as number) ?? 3;
      const suggested = pickSuggestedDate(cw);
      return {
        taskId: t.id,
        title: t.title,
        description: (t.payload.description as string) ?? undefined,
        originalDate: t.date,
        cognitiveWeight: cw,
        durationMinutes: (t.payload.durationMinutes as number) ?? 30,
        goalId: t.goalId,
        goalTitle: t.goalId ? goalMap.get(t.goalId) : undefined,
        rescheduleCount: (t.payload.rescheduleCount as number) ?? 0,
        suggestedDate: suggested,
        suggestedDateLabel: formatSuggestedLabel(suggested),
      };
    }),
    // Append plan-tree tasks that were just materialized as daily_tasks.
    ...materializedReschedules.map((mr) => ({
      ...mr,
      suggestedDate: pickSuggestedDate(mr.cognitiveWeight),
      suggestedDateLabel: formatSuggestedLabel(pickSuggestedDate(mr.cognitiveWeight)),
    })),
  ];

  // Overload detection: when 5+ tasks are waiting to be rescheduled,
  // group by goal so the UI can offer a batch "adjust all plans" action.
  const OVERLOAD_THRESHOLD = 5;
  const overloadedGoals: OverloadedGoalSummary[] = [];
  if (pendingReschedules.length >= OVERLOAD_THRESHOLD) {
    const byGoal = new Map<string, { goalTitle: string; count: number }>();
    for (const r of pendingReschedules) {
      if (!r.goalId) continue;
      const entry = byGoal.get(r.goalId) ?? { goalTitle: r.goalTitle ?? "", count: 0 };
      entry.count++;
      byGoal.set(r.goalId, entry);
    }
    for (const [goalId, { goalTitle, count }] of byGoal) {
      overloadedGoals.push({ goalId, goalTitle, overdueCount: count });
    }
    overloadedGoals.sort((a, b) => b.overdueCount - a.overdueCount);
  }

  const activeGoals = goals.filter(
    (g) => g.status !== "archived" && g.status !== "completed",
  );

  return {
    todayDate: today,
    todayLog,
    dailyLogs: hydratedLogs,
    heatmapData,
    goals,
    bigGoalProgress: computeBigGoalProgress(goals),
    activeReminders,
    todayReminders,
    overdueReminders,
    recentNudges: nudges.map(nudgeToContextual),
    vacationMode,
    totalIncompleteTasks,
    todayProgress,
    pendingGoalTasks,
    pendingReschedules,
    paceMismatches,
    weeklyReviewDue,
    allTasksCompleted,
    overloadedGoals,
    hasGoals: activeGoals.length > 0,
    hasTodayPlan: todayLog !== null && (todayLog.tasks?.length ?? 0) > 0,
    pooledTaskCount,
  };
}
