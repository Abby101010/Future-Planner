/* Starward — shared daily-task generation + persistence
 *
 * Extracted from the POST /ai/daily-tasks route so it can be called
 * both from the HTTP handler (manual refresh) and from resolveTasksView
 * (on-demand auto-generation when the page loads and no log exists).
 */

import * as repos from "../repositories";
import { handleDailyTasksCopy } from "../ai/handlers/dailyTasksCopy";
import { getClient } from "../ai/client";
import { loadMemory, buildMemoryContext } from "../memory";
import { getCurrentUserId } from "../middleware/requestContext";
import { getEffectiveDate } from "../dateUtils";
import { COGNITIVE_BUDGET, selectDailyTasks } from "@starward/core";
import type { Goal, DailyLog, HeatmapEntry, Reminder, TaskStateInput, GoalSummary, ScheduledTaskSummary, DailyLogSummary, TierEnforcement } from "@starward/core";

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
    .filter(
      (g) =>
        // A-5: paused goals sit out daily materialization. Resume flips the
        // status back to "active" and tasks flow again.
        g.status !== "paused" &&
        (g.goalType === "big" || (!g.goalType && g.scope === "big")),
    )
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

function buildScheduleBlockText(tier: TierEnforcement): string {
  const lines: string[] = ["SCHEDULE STRUCTURE (pre-computed by rule engine):"];

  lines.push("Tier 1 — Calendar (FIXED, do not move):");
  if (tier.calendarBlocks.length === 0) {
    lines.push("  (none)");
  } else {
    for (const b of tier.calendarBlocks) {
      lines.push(`  [${b.startTime}-${b.endTime}] ${b.label} (${b.durationMinutes}min)`);
    }
  }

  lines.push("Tier 2 — Goal Deep Work (PROTECTED):");
  if (tier.goalBlocks.length === 0) {
    lines.push("  (none)");
  } else {
    for (const b of tier.goalBlocks) {
      lines.push(`  [${b.startTime || "flex"}-${b.endTime || "flex"}] ${b.label} (${b.durationMinutes}min)`);
    }
  }

  lines.push("Tier 3 — Available for daily tasks:");
  if (tier.taskSlots.length === 0) {
    lines.push("  (none)");
  } else {
    let totalAvailable = 0;
    for (const b of tier.taskSlots) {
      lines.push(`  [${b.startTime || "flex"}-${b.endTime || "flex"}] ${b.durationMinutes}min`);
      totalAvailable += b.durationMinutes;
    }
    lines.push(`Total available: ${totalAvailable}min`);
  }

  return lines.join("\n");
}

/** Generate daily tasks via the AI handler and persist the result.
 *
 *  - `dryRun`: run the AI but don't persist — return proposals only.
 *  - `preserveExisting`: keep completed / user-created / skipped tasks;
 *    only replace incomplete AI-generated tasks. Feeds protected tasks
 *    to the AI as `confirmedQuickTasks` so it generates complementary work.
 */
export async function generateAndPersistDailyTasks(opts: {
  date?: string;
  goals?: Goal[];
  pastLogs?: DailyLog[];
  heatmapData?: HeatmapEntry[];
  activeReminders?: Reminder[];
  dryRun?: boolean;
  preserveExisting?: boolean;
}): Promise<GeneratedResult> {
  const date = opts.date ?? getEffectiveDate();

  // Skip generation if vacation mode is active
  const vacation = await repos.vacationMode.get();
  if (vacation?.active) {
    const inRange = !vacation.startDate || !vacation.endDate
      || (date >= vacation.startDate && date <= vacation.endDate);
    if (inRange) {
      return {
        date,
        tasks: [],
        adaptiveReasoning: "Vacation mode is active — no tasks generated.",
      };
    }
  }

  const goals = opts.goals ?? [];
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

  const userId = getCurrentUserId();
  const memory = await loadMemory(userId);
  const memoryContext = await buildMemoryContext(memory, "daily");

  // Always feed user-created tasks to the AI so the coordinator generates
  // complementary work within the remaining budget. In preserveExisting
  // mode we also protect completed/skipped tasks; in default mode we only
  // protect explicit user-created tasks (chat, manual, pending-confirmed).
  let confirmedQuickTasks: Array<Record<string, unknown>> = [];
  const preExistingTasks = await repos.dailyTasks.listForDate(date);
  {
    const isProtected = (t: typeof preExistingTasks[number]): boolean => {
      if (opts.preserveExisting) {
        if (t.completed) return true;
        const pl = t.payload as Record<string, unknown>;
        if (pl?.skipped) return true;
      }
      const pl = t.payload as Record<string, unknown>;
      return (pl?.source as string) !== "ai-generated" && pl?.source !== undefined;
    };
    confirmedQuickTasks = preExistingTasks
      .filter(isProtected)
      .map((t) => {
        const pl = t.payload as Record<string, unknown>;
        return {
          title: t.title,
          description: (pl?.description as string) ?? "",
          durationMinutes: (pl?.durationMinutes as number) ?? 30,
          cognitiveWeight: (pl?.cognitiveWeight as number) ?? 3,
          priority: (pl?.priority as string) ?? "should-do",
          category: (pl?.category as string) ?? "planning",
        };
      });
  }

  const payload: Record<string, unknown> = {
    date,
    pastLogs,
    heatmap: opts.heatmapData ?? [],
    goalPlanSummaries,
    everydayGoals,
    repeatingGoals,
    todayReminders,
    goals: activeGoals.map((g) => ({
      title: g.title,
      goalType: g.goalType,
      scope: g.scope,
      status: g.status,
      targetDate: g.targetDate,
    })),
    confirmedQuickTasks,
    isVacationDay: false,
  };

  // ── Rule Engine: deterministic task selection ──
  // Replaces the 3-AI-call coordinator pipeline (gatekeeper + timeEstimator + scheduler)
  // with pure scoring in @starward/core.
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

  // Build scheduled task summaries from DB (tasks with scheduledTime)
  const scheduledTaskRecords = await repos.dailyTasks.listForDate(date);
  const scheduledTasks: ScheduledTaskSummary[] = scheduledTaskRecords
    .filter((t) => (t.payload as Record<string, unknown>).scheduledTime)
    .map((t) => {
      const p = t.payload as Record<string, unknown>;
      return {
        id: t.id,
        title: t.title,
        date: t.date,
        scheduledTime: p.scheduledTime as string | undefined,
        scheduledEndTime: p.scheduledEndTime as string | undefined,
        durationMinutes: (p.durationMinutes as number) ?? 30,
        category: (p.category as string) ?? "",
        isAllDay: (p.isAllDay as boolean) ?? false,
      };
    });

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
    scheduledTasks,
    pastLogs: logSummaries,
    memoryContext,
    capacityBudget: COGNITIVE_BUDGET.MAX_DAILY_WEIGHT,
    recentCompletionRate,
  };

  // Build goal importance map from actual Goal objects
  const goalImportance: Record<string, string> = {};
  for (const g of activeGoals) {
    goalImportance[g.id] = g.importance ?? "medium";
  }

  const ruleEngineResult = selectDailyTasks(taskStateInput, { goalImportance });

  // ── Step 2: Haiku copy generation ──
  // The rule engine already selected and sequenced tasks. Now we just need
  // a lightweight Haiku call to generate why_today + briefing copy.
  const client = getClient();
  if (!client) {
    throw new Error("ANTHROPIC_API_KEY not configured on server.");
  }

  const yesterday = pastLogs.length > 0 ? pastLogs[pastLogs.length - 1] : null;
  const yesterdayRecap = yesterday
    ? {
        tasksCompleted: yesterday.tasks?.filter((t) => t.completed).length ?? 0,
        tasksTotal: yesterday.tasks?.length ?? 0,
      }
    : null;

  const copyResult = await handleDailyTasksCopy(client, {
    date,
    selectedTasks: ruleEngineResult.selectedTasks,
    yesterdayRecap,
    memoryContext,
    recentCompletionRate,
    recommendedCount: ruleEngineResult.recommendedCount,
  });

  // ── Assemble result from rule engine + copy handler ──
  const result: GeneratedResult = {
    id: `log-${date}`,
    date,
    tasks: ruleEngineResult.selectedTasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      durationMinutes: t.durationMinutes,
      cognitiveWeight: t.cognitiveWeight,
      whyToday: copyResult.taskCopy[t.id]?.whyToday ?? (t.goalTitle ? `Keeps "${t.goalTitle}" on track.` : "Planned for today."),
      priority: t.signal === "high" ? "must-do" : t.signal === "medium" ? "should-do" : "bonus",
      isMomentumTask: t.cognitiveWeight <= 2 && t.durationMinutes <= 15,
      progressContribution: "",
      category: t.category,
      completed: false,
      goalId: t.goalId,
      planNodeId: t.planNodeId,
    })),
    notificationBriefing: copyResult.notificationBriefing,
    adaptiveReasoning: copyResult.adaptiveReasoning,
    encouragement: copyResult.encouragement,
    heatmapEntry: {
      date,
      completionLevel: 0,
      currentStreak: 0,
      totalActiveDays: 0,
      longestStreak: 0,
    },
  };

  // ── dryRun: return proposals without persisting ──
  if (opts.dryRun) {
    return result;
  }

  // ── Persist ──
  if (opts.preserveExisting) {
    // Only remove incomplete AI-generated tasks; keep everything else.
    const existing = await repos.dailyTasks.listForDate(date);
    const replaceableIds: string[] = [];
    let maxProtectedOrder = -1;

    for (const t of existing) {
      const pl = t.payload as Record<string, unknown>;
      const isProtected =
        t.completed ||
        !!pl?.skipped ||
        pl?.source !== "ai-generated"; // user-created, pending-confirmed, or legacy
      if (isProtected) {
        if (t.orderIndex > maxProtectedOrder) maxProtectedOrder = t.orderIndex;
      } else {
        replaceableIds.push(t.id);
      }
    }

    for (const id of replaceableIds) {
      await repos.dailyTasks.remove(id);
    }

    const startOrder = maxProtectedOrder + 1;
    for (let i = 0; i < result.tasks.length; i++) {
      const t = result.tasks[i];
      await repos.dailyTasks.insert({
        id: t.id,
        date,
        title: t.title,
        completed: t.completed ?? false,
        orderIndex: startOrder + i,
        goalId: t.goalId ?? null,
        planNodeId: t.planNodeId ?? null,
        source: t.goalId ? "big_goal" : "user_created",
        payload: {
          description: t.description,
          durationMinutes: t.durationMinutes,
          cognitiveWeight: t.cognitiveWeight,
          whyToday: t.whyToday,
          priority: t.priority,
          isMomentumTask: t.isMomentumTask,
          progressContribution: t.progressContribution,
          category: t.category,
          source: "ai-generated",
        },
      });
    }
    // Do NOT reset tasksConfirmed — plan stays locked.
  } else {
    // Default: wipe AI-generated tasks but preserve user-created/chat tasks.
    // User-created tasks represent explicit user intent and should survive
    // regeneration. They were already fed to the coordinator above so the
    // AI generated complementary work around them.
    const userCreatedRows = preExistingTasks.filter((t) => {
      const pl = t.payload as Record<string, unknown>;
      const src = pl?.source as string | undefined;
      return src !== undefined && src !== "ai-generated";
    });
    const userCreatedIds = new Set(userCreatedRows.map((t) => t.id));

    // Remove only AI-generated tasks (or tasks with no source — legacy)
    for (const t of preExistingTasks) {
      if (!userCreatedIds.has(t.id)) {
        await repos.dailyTasks.remove(t.id);
      }
    }

    // Insert AI-generated tasks after the preserved user-created ones
    const startOrder = userCreatedRows.length;
    for (let i = 0; i < result.tasks.length; i++) {
      const t = result.tasks[i];
      await repos.dailyTasks.insert({
        id: t.id,
        date,
        title: t.title,
        completed: t.completed ?? false,
        orderIndex: startOrder + i,
        goalId: t.goalId ?? null,
        planNodeId: t.planNodeId ?? null,
        source: t.goalId ? "big_goal" : "user_created",
        payload: {
          description: t.description,
          durationMinutes: t.durationMinutes,
          cognitiveWeight: t.cognitiveWeight,
          whyToday: t.whyToday,
          priority: t.priority,
          isMomentumTask: t.isMomentumTask,
          progressContribution: t.progressContribution,
          category: t.category,
          source: "ai-generated",
        },
      });
    }

    await repos.dailyLogs.upsert({
      date,
      payload: {
        id: result.id ?? `log-${date}`,
        notificationBriefing: result.notificationBriefing ?? "",
        adaptiveReasoning: result.adaptiveReasoning ?? "",
        tasksConfirmed: false,
        milestoneCelebration: result.milestoneCelebration ?? null,
        progress: result.progress ?? null,
        yesterdayRecap: result.yesterdayRecap ?? null,
        encouragement: result.encouragement ?? "",
        heatmapEntry: result.heatmapEntry ?? null,
      },
    });
  }

  if (result.heatmapEntry) {
    await repos.heatmap.upsert(result.heatmapEntry);
  }

  return result;
}
