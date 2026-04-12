/* NorthStar server — view-layer DB-record → core-type mappers.
 *
 * Repositories return DB-shape records (payload jsonb + column fields).
 * Views use these helpers to hand the client fully-typed @northstar/core
 * objects so pages render without any client-side flattening.
 */

import type {
  ContextualNudge,
  DailyLog,
  DailyTask,
} from "@northstar/core";
import type { DailyLogRecord } from "../repositories/dailyLogsRepo";
import type { DailyTaskRecord } from "../repositories/dailyTasksRepo";
import type { NudgeRecord } from "../repositories/nudgesRepo";

export function flattenDailyTask(r: DailyTaskRecord): DailyTask {
  const p = r.payload || {};
  return {
    id: r.id,
    title: r.title,
    description: (p.description as string) ?? "",
    durationMinutes: (p.durationMinutes as number) ?? 30,
    cognitiveWeight: p.cognitiveWeight as DailyTask["cognitiveWeight"],
    whyToday: (p.whyToday as string) ?? "",
    priority: (p.priority as DailyTask["priority"]) ?? "should-do",
    isMomentumTask: (p.isMomentumTask as boolean) ?? false,
    progressContribution: (p.progressContribution as string) ?? "",
    category: (p.category as DailyTask["category"]) ?? "planning",
    completed: r.completed,
    completedAt: r.completedAt ?? undefined,
    startedAt: p.startedAt as string | undefined,
    actualMinutes: p.actualMinutes as number | undefined,
    snoozedCount: p.snoozedCount as number | undefined,
    skipped: p.skipped as boolean | undefined,
    goalId: r.goalId ?? null,
    planNodeId: r.planNodeId ?? null,
  };
}

export function hydrateDailyLog(
  log: DailyLogRecord,
  taskRecords: DailyTaskRecord[],
): DailyLog {
  const p = log.payload || {};
  return {
    id: (p.id as string) ?? `log-${log.date}`,
    userId: (p.userId as string) ?? "",
    date: log.date,
    tasks: taskRecords.map(flattenDailyTask),
    heatmapEntry: (p.heatmapEntry as DailyLog["heatmapEntry"]) ?? {
      date: log.date,
      completionLevel: 0,
      currentStreak: 0,
      totalActiveDays: 0,
      longestStreak: 0,
    },
    notificationBriefing: (p.notificationBriefing as string) ?? "",
    milestoneCelebration:
      (p.milestoneCelebration as DailyLog["milestoneCelebration"]) ?? null,
    progress: (p.progress as DailyLog["progress"]) ?? {
      overallPercent: 0,
      milestonePercent: 0,
      currentMilestone: "",
      projectedCompletion: "",
      daysAheadOrBehind: 0,
    },
    yesterdayRecap: (p.yesterdayRecap as DailyLog["yesterdayRecap"]) ?? null,
    encouragement: (p.encouragement as string) ?? "",
    mood: (p.mood as DailyLog["mood"]) ?? log.mood ?? undefined,
    tasksConfirmed: (p.tasksConfirmed as boolean) ?? true,
    adaptiveReasoning: (p.adaptiveReasoning as string) ?? "",
    createdAt: log.createdAt,
  };
}

export function nudgeToContextual(n: NudgeRecord): ContextualNudge {
  return {
    id: n.id,
    type: n.kind,
    message: n.body,
    actions: n.actions,
    priority: n.priority,
    context: n.context,
    dismissed: n.dismissedAt !== null,
  };
}
