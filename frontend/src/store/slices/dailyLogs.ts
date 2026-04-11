/* NorthStar — daily logs slice (logs, todayLog, task actions, heatmap, pending tasks) */

import type { StateCreator } from "zustand";
import type {
  DailyLog,
  HeatmapEntry,
  PendingTask,
  DailyTask,
} from "../../types";
import {
  recordTaskCompleted,
  recordTaskSkipped,
  recordTaskSnoozed,
  recordTaskTiming,
  recordSignal,
} from "../../services/memory";
import { entitiesRepo } from "../../repositories";
import type { StoreApi } from "../useStore";

export interface DailyLogsSlice {
  dailyLogs: DailyLog[];
  todayLog: DailyLog | null;
  setTodayLog: (log: DailyLog) => void;
  addDailyLog: (log: DailyLog) => void;
  toggleTask: (taskId: string) => void;
  snoozeTask: (taskId: string) => void;
  skipTask: (taskId: string) => void;
  startTaskTimer: (taskId: string) => void;
  stopTaskTimer: (taskId: string) => void;

  heatmapData: HeatmapEntry[];
  setHeatmapData: (data: HeatmapEntry[]) => void;

  pendingTasks: PendingTask[];
  addPendingTask: (task: PendingTask) => void;
  updatePendingTask: (id: string, updates: Partial<PendingTask>) => void;
  removePendingTask: (id: string) => void;
  confirmPendingTask: (id: string) => Promise<void>;
}

export const createDailyLogsSlice: StateCreator<
  StoreApi,
  [],
  [],
  DailyLogsSlice
> = (set, get) => ({
  dailyLogs: [],
  todayLog: null,
  setTodayLog: (log) => set({ todayLog: log }),
  addDailyLog: (log) => {
    set((s) => ({ dailyLogs: [...s.dailyLogs, log], todayLog: log }));
    get().saveToDisk();
  },
  toggleTask: (taskId) => {
    const log = get().todayLog;
    if (!log) return;
    const targetTask = log.tasks.find((t) => t.id === taskId);
    const tasks = log.tasks.map((t) =>
      t.id === taskId
        ? {
            ...t,
            completed: !t.completed,
            completedAt: !t.completed ? new Date().toISOString() : undefined,
          }
        : t,
    );
    const updated = { ...log, tasks };
    const completedCount = tasks.filter((t) => t.completed).length;
    const ratio = tasks.length > 0 ? completedCount / tasks.length : 0;
    let level: 0 | 1 | 2 | 3 | 4 = 0;
    if (ratio === 1) level = 4;
    else if (ratio >= 0.8) level = 3;
    else if (ratio >= 0.5) level = 2;
    else if (ratio > 0) level = 1;
    updated.heatmapEntry = { ...updated.heatmapEntry, completionLevel: level };
    set({ todayLog: updated });
    set((s) => ({
      dailyLogs: s.dailyLogs.map((l) => (l.id === log.id ? updated : l)),
    }));
    get().saveToDisk();

    if (targetTask && !targetTask.completed) {
      recordTaskCompleted(
        targetTask.title,
        targetTask.category,
        targetTask.durationMinutes,
        targetTask.durationMinutes,
      ).catch(() => {});
    }
  },

  snoozeTask: (taskId) => {
    const log = get().todayLog;
    if (!log) return;
    const target = log.tasks.find((t) => t.id === taskId);
    if (!target) return;
    const tasks = log.tasks.map((t) =>
      t.id === taskId ? { ...t, snoozedCount: (t.snoozedCount ?? 0) + 1 } : t,
    );
    const updated = { ...log, tasks };
    set({ todayLog: updated });
    set((s) => ({
      dailyLogs: s.dailyLogs.map((l) => (l.id === log.id ? updated : l)),
    }));
    get().saveToDisk();
    recordTaskSnoozed(
      target.title,
      target.category,
      new Date().toISOString(),
    ).catch(() => {});
  },

  skipTask: (taskId) => {
    const log = get().todayLog;
    if (!log) return;
    const target = log.tasks.find((t) => t.id === taskId);
    if (!target) return;
    const tasks = log.tasks.map((t) =>
      t.id === taskId ? { ...t, skipped: true } : t,
    );
    const updated = { ...log, tasks };
    set({ todayLog: updated });
    set((s) => ({
      dailyLogs: s.dailyLogs.map((l) => (l.id === log.id ? updated : l)),
    }));
    get().saveToDisk();
    recordTaskSkipped(target.title, target.category, "user_skipped").catch(
      () => {},
    );
  },

  startTaskTimer: (taskId) => {
    const log = get().todayLog;
    if (!log) return;
    const tasks = log.tasks.map((t) =>
      t.id === taskId ? { ...t, startedAt: new Date().toISOString() } : t,
    );
    const updated = { ...log, tasks };
    set({ todayLog: updated });
    set((s) => ({
      dailyLogs: s.dailyLogs.map((l) => (l.id === log.id ? updated : l)),
    }));
    get().saveToDisk();
  },

  stopTaskTimer: (taskId) => {
    const log = get().todayLog;
    if (!log) return;
    const target = log.tasks.find((t) => t.id === taskId);
    if (!target || !target.startedAt) return;
    const startedAt = new Date(target.startedAt).getTime();
    const actualMinutes = Math.round((Date.now() - startedAt) / 60000);
    const tasks = log.tasks.map((t) =>
      t.id === taskId ? { ...t, actualMinutes, startedAt: undefined } : t,
    );
    const updated = { ...log, tasks };
    set({ todayLog: updated });
    set((s) => ({
      dailyLogs: s.dailyLogs.map((l) => (l.id === log.id ? updated : l)),
    }));
    get().saveToDisk();
    recordTaskTiming(
      target.title,
      target.category,
      target.durationMinutes,
      actualMinutes,
    ).catch(() => {});
  },

  heatmapData: [],
  setHeatmapData: (data) => set({ heatmapData: data }),

  pendingTasks: [],
  addPendingTask: (task) => {
    set((s) => ({ pendingTasks: [...s.pendingTasks, task] }));
    get().saveToDisk();
  },
  updatePendingTask: (id, updates) => {
    set((s) => ({
      pendingTasks: s.pendingTasks.map((t) =>
        t.id === id ? { ...t, ...updates } : t,
      ),
    }));
    get().saveToDisk();
  },
  removePendingTask: (id) => {
    set((s) => ({ pendingTasks: s.pendingTasks.filter((t) => t.id !== id) }));
    get().saveToDisk();
  },
  confirmPendingTask: async (id) => {
    const task = get().pendingTasks.find((t) => t.id === id);
    if (!task || !task.analysis) return;

    const todayLog = get().todayLog;
    const today = new Date().toISOString().split("T")[0];

    const isScheduledToday = task.analysis.suggestedDate === today;
    const newTask = (await entitiesRepo.newConfirmedTask({
      title: task.analysis.title,
      description: task.analysis.description,
      durationMinutes: task.analysis.durationMinutes,
      cognitiveWeight: task.analysis.cognitiveWeight,
      priority: task.analysis.priority,
      category: task.analysis.category,
      whyToday: task.analysis.reasoning,
      progressContribution: "Quick task added via chat",
      isMomentumTask: false,
      isScheduledToday,
      currentTasks: (todayLog?.tasks ?? []).map((t) => ({
        cognitiveWeight: t.cognitiveWeight,
        durationMinutes: t.durationMinutes,
        priority: t.priority,
      })),
    })) as DailyTask;

    if (todayLog) {
      const updated = { ...todayLog, tasks: [...todayLog.tasks, newTask] };
      set({ todayLog: updated });
      set((s) => ({
        dailyLogs: s.dailyLogs.map((l) =>
          l.id === todayLog.id ? updated : l,
        ),
      }));
    } else {
      const baseLog = (await entitiesRepo.newLog({
        userId: get().user?.id || "",
        date: today,
        tasks: [newTask],
      })) as unknown as DailyLog;
      const newLog: DailyLog = {
        ...baseLog,
        heatmapEntry: {
          date: today,
          completionLevel: 0,
          currentStreak: 0,
          totalActiveDays: 0,
          longestStreak: 0,
        } as unknown as DailyLog["heatmapEntry"],
        progress: {
          overallPercent: 0,
          milestonePercent: 0,
          currentMilestone: "",
          projectedCompletion: "",
          daysAheadOrBehind: 0,
        } as unknown as DailyLog["progress"],
      };
      set({ todayLog: newLog });
      set((s) => ({ dailyLogs: [...s.dailyLogs, newLog] }));
    }

    set((s) => ({
      pendingTasks: s.pendingTasks.filter((t) => t.id !== id),
    }));
    get().saveToDisk();
    recordSignal(
      "task_confirmed",
      "quick_task",
      `${task.analysis.title} [${newTask.priority}]`,
    ).catch(() => {});
  },
});
