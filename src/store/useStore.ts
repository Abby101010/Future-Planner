/* ──────────────────────────────────────────────────────────
   NorthStar — Zustand application store
   ────────────────────────────────────────────────────────── */

import { create } from "zustand";
import type {
  AppView,
  UserProfile,
  Roadmap,
  GoalBreakdown,
  CalendarEvent,
  DeviceIntegrations,
  MonthlyContext,
  DailyLog,
  ConversationMessage,
  HeatmapEntry,
  MoodEntry,
  UserSettings,
  MemorySummary,
  ContextualNudge,
  Goal,
  GoalType,
  GoalPlanMessage,
  GoalPlan,
  PendingTask,
  HomeChatMessage,
} from "../types";
import {
  recordTaskCompleted,
  recordTaskSkipped,
  recordTaskSnoozed,
  recordTaskTiming,
  recordFeedback,
  recordSignal,
  getNudges,
  shouldAutoReflect,
  triggerReflection,
} from "../services/memory";

const DEFAULT_INTEGRATIONS: DeviceIntegrations = {
  calendar: { enabled: false, selectedCalendars: [] },
  reminders: { enabled: false, selectedLists: [] },
};

interface Store {
  // View state
  currentView: AppView;
  setView: (view: AppView) => void;

  // User
  user: UserProfile | null;
  setUser: (user: UserProfile) => void;
  updateSettings: (settings: Partial<UserSettings>) => void;

  // Onboarding conversation
  conversations: ConversationMessage[];
  addMessage: (msg: ConversationMessage) => void;
  clearConversation: () => void;

  // Goal Breakdown (new main feature)
  goalBreakdown: GoalBreakdown | null;
  setGoalBreakdown: (b: GoalBreakdown | null) => void;

  // ── Goals (new system) ──
  goals: Goal[];
  addGoal: (goal: Goal) => void;
  updateGoal: (id: string, updates: Partial<Goal>) => void;
  removeGoal: (id: string) => void;
  addGoalPlanMessage: (goalId: string, msg: GoalPlanMessage) => void;
  setGoalPlan: (goalId: string, plan: GoalPlan) => void;
  confirmGoalPlan: (goalId: string) => void;
  getBigGoals: () => Goal[];
  getEverydayGoals: () => Goal[];
  getRepeatingGoals: () => Goal[];
  getGoalsByType: (type: GoalType) => Goal[];

  // Vacation mode
  vacationMode: { active: boolean; startDate: string; endDate: string } | null;
  setVacationMode: (mode: { active: boolean; startDate: string; endDate: string } | null) => void;

  // ── Monthly Context ──
  monthlyContexts: MonthlyContext[];
  setMonthlyContext: (ctx: MonthlyContext) => void;
  removeMonthlyContext: (month: string) => void;
  getMonthlyContext: (month: string) => MonthlyContext | null;
  getCurrentMonthContext: () => MonthlyContext | null;

  // In-app calendar
  calendarEvents: CalendarEvent[];
  addCalendarEvent: (e: CalendarEvent) => void;
  updateCalendarEvent: (id: string, updates: Partial<CalendarEvent>) => void;
  removeCalendarEvent: (id: string) => void;
  setCalendarEvents: (events: CalendarEvent[]) => void;

  // Device integrations
  deviceIntegrations: DeviceIntegrations;
  setDeviceIntegrations: (d: DeviceIntegrations) => void;
  updateIntegration: (
    key: keyof DeviceIntegrations,
    updates: Partial<DeviceIntegrations[keyof DeviceIntegrations]>
  ) => void;

  // Roadmap (legacy)
  roadmap: Roadmap | null;
  setRoadmap: (r: Roadmap | null) => void;

  // ── Daily logs ──
  dailyLogs: DailyLog[];
  todayLog: DailyLog | null;
  setTodayLog: (log: DailyLog) => void;
  addDailyLog: (log: DailyLog) => void;
  toggleTask: (taskId: string) => void;
  snoozeTask: (taskId: string) => void;
  skipTask: (taskId: string) => void;
  startTaskTimer: (taskId: string) => void;
  stopTaskTimer: (taskId: string) => void;

  // ── Heatmap ──
  heatmapData: HeatmapEntry[];
  setHeatmapData: (data: HeatmapEntry[]) => void;

  // ── Mood (opt-in) ──
  moodEntries: MoodEntry[];
  addMoodEntry: (entry: MoodEntry) => void;

  // ── Loading & errors ──
  isLoading: boolean;
  setLoading: (v: boolean) => void;
  error: string | null;
  setError: (e: string | null) => void;

  // ── Active Jobs (background job queue tracking) ──
  activeJobs: Record<string, { type: string; status: string; progress: number }>;
  setActiveJob: (jobId: string, info: { type: string; status: string; progress: number }) => void;
  clearActiveJob: (jobId: string) => void;

  // ── Memory (Three-Tier Architecture) ──
  memorySummary: MemorySummary | null;
  refreshMemorySummary: () => Promise<void>;

  // ── Contextual Nudges ──
  nudges: ContextualNudge[];
  refreshNudges: () => Promise<void>;
  dismissNudge: (nudgeId: string) => void;
  respondToNudge: (nudgeId: string, feedbackValue: string, isPositive: boolean) => void;

  // ── Pending Tasks (quick-add via chat) ──
  pendingTasks: PendingTask[];
  addPendingTask: (task: PendingTask) => void;
  updatePendingTask: (id: string, updates: Partial<PendingTask>) => void;
  removePendingTask: (id: string) => void;
  confirmPendingTask: (id: string) => void;

  // ── Home Chat ──
  homeChatMessages: HomeChatMessage[];
  addHomeChatMessage: (msg: HomeChatMessage) => void;
  clearHomeChat: () => void;

  // ── Persistence ──
  loadFromDisk: () => Promise<void>;
  saveToDisk: () => Promise<void>;
  resetGoalData: () => Promise<void>;
}

const useStore = create<Store>((set, get) => ({
  // ── View ──
  currentView: "welcome",
  setView: (view) => {
    set({ currentView: view });
    recordSignal("navigation", "page_view", view).catch(() => {});
  },

  // ── User ──
  user: null,
  setUser: (user) => {
    set({ user });
    get().saveToDisk();
  },
  updateSettings: (partial) => {
    const user = get().user;
    if (!user) return;
    set({ user: { ...user, settings: { ...user.settings, ...partial } } });
    get().saveToDisk();
  },

  // ── Conversation ──
  conversations: [],
  addMessage: (msg) =>
    set((s) => ({ conversations: [...s.conversations, msg] })),
  clearConversation: () => set({ conversations: [] }),

  // Roadmap (legacy)
  roadmap: null,
  setRoadmap: (r) => {
    set({ roadmap: r });
    get().saveToDisk();
  },

  // Goal Breakdown
  goalBreakdown: null,
  setGoalBreakdown: (b) => {
    set({ goalBreakdown: b });
    get().saveToDisk();
  },

  // ── Goals ──
  goals: [],
  addGoal: (goal) => {
    set((s) => ({ goals: [...s.goals, goal] }));
    get().saveToDisk();
    recordSignal("goal_created", goal.goalType || "unknown", goal.title).catch(() => {});
  },
  updateGoal: (id, updates) => {
    set((s) => ({
      goals: s.goals.map((g) =>
        g.id === id ? { ...g, ...updates, updatedAt: new Date().toISOString() } : g
      ),
    }));
    get().saveToDisk();
  },
  removeGoal: (id) => {
    const goal = get().goals.find((g) => g.id === id);
    set((s) => ({ goals: s.goals.filter((g) => g.id !== id) }));
    get().saveToDisk();
    if (goal) {
      recordSignal("goal_deleted", goal.goalType || "unknown", goal.title).catch(() => {});
    }
  },
  addGoalPlanMessage: (goalId, msg) => {
    set((s) => ({
      goals: s.goals.map((g) =>
        g.id === goalId
          ? { ...g, planChat: [...g.planChat, msg], updatedAt: new Date().toISOString() }
          : g
      ),
    }));
    get().saveToDisk();
  },
  setGoalPlan: (goalId, plan: GoalPlan) => {
    set((s) => ({
      goals: s.goals.map((g) =>
        g.id === goalId
          ? { ...g, plan, status: "planning" as const, updatedAt: new Date().toISOString() }
          : g
      ),
    }));
    get().saveToDisk();
  },
  confirmGoalPlan: (goalId) => {
    const goal = get().goals.find((g) => g.id === goalId);
    set((s) => ({
      goals: s.goals.map((g) =>
        g.id === goalId
          ? { ...g, planConfirmed: true, status: "active" as const, updatedAt: new Date().toISOString() }
          : g
      ),
    }));
    get().saveToDisk();
    if (goal) {
      recordSignal("plan_confirmed", "big", goal.title).catch(() => {});
    }
  },
  getBigGoals: () => {
    return get().goals.filter((g) => g.scope === "big" && g.status !== "archived");
  },
  getEverydayGoals: () => {
    return get().goals.filter((g) => (g.goalType === "everyday" || (!g.goalType && g.scope === "small")) && g.status !== "archived" && g.status !== "completed");
  },
  getRepeatingGoals: () => {
    return get().goals.filter((g) => g.goalType === "repeating" && g.status !== "archived");
  },
  getGoalsByType: (type: GoalType) => {
    return get().goals.filter((g) => g.goalType === type && g.status !== "archived");
  },

  // Vacation mode
  vacationMode: null,
  setVacationMode: (mode) => {
    set({ vacationMode: mode });
    get().saveToDisk();
    recordSignal("vacation_mode", mode ? "activated" : "deactivated", mode ? `${mode.startDate} to ${mode.endDate}` : "ended").catch(() => {});
  },

  // ── Monthly Context ──
  monthlyContexts: [],
  setMonthlyContext: (ctx) => {
    set((s) => {
      const existing = s.monthlyContexts.findIndex((c) => c.month === ctx.month);
      if (existing >= 0) {
        const updated = [...s.monthlyContexts];
        updated[existing] = ctx;
        return { monthlyContexts: updated };
      }
      return { monthlyContexts: [...s.monthlyContexts, ctx] };
    });
    get().saveToDisk();
    recordSignal("monthly_context_set", ctx.month, `${ctx.intensity}: ${ctx.description.slice(0, 100)}`).catch(() => {});
  },
  removeMonthlyContext: (month) => {
    set((s) => ({
      monthlyContexts: s.monthlyContexts.filter((c) => c.month !== month),
    }));
    get().saveToDisk();
  },
  getMonthlyContext: (month) => {
    return get().monthlyContexts.find((c) => c.month === month) || null;
  },
  getCurrentMonthContext: () => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return get().monthlyContexts.find((c) => c.month === currentMonth) || null;
  },

  // In-app calendar
  calendarEvents: [],
  addCalendarEvent: (e) => {
    set((s) => ({ calendarEvents: [...s.calendarEvents, e] }));
    get().saveToDisk();
  },
  updateCalendarEvent: (id, updates) => {
    set((s) => ({
      calendarEvents: s.calendarEvents.map((e) =>
        e.id === id ? { ...e, ...updates } : e
      ),
    }));
    get().saveToDisk();
  },
  removeCalendarEvent: (id) => {
    set((s) => ({
      calendarEvents: s.calendarEvents.filter((e) => e.id !== id),
    }));
    get().saveToDisk();
  },
  setCalendarEvents: (events) => {
    set({ calendarEvents: events });
    get().saveToDisk();
  },

  // Device integrations
  deviceIntegrations: DEFAULT_INTEGRATIONS,
  setDeviceIntegrations: (d) => {
    set({ deviceIntegrations: d });
    get().saveToDisk();
  },
  updateIntegration: (key, updates) => {
    set((s) => ({
      deviceIntegrations: {
        ...s.deviceIntegrations,
        [key]: { ...s.deviceIntegrations[key], ...updates },
      },
    }));
    get().saveToDisk();
  },

  // ── Daily logs ──
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
        : t
    );
    const updated = { ...log, tasks };
    // Update heatmap completion level
    const completedCount = tasks.filter((t) => t.completed).length;
    const ratio = tasks.length > 0 ? completedCount / tasks.length : 0;
    let level: 0 | 1 | 2 | 3 | 4 = 0;
    if (ratio === 1) level = 4;
    else if (ratio >= 0.8) level = 3;
    else if (ratio >= 0.5) level = 2;
    else if (ratio > 0) level = 1;
    updated.heatmapEntry = { ...updated.heatmapEntry, completionLevel: level };
    set({ todayLog: updated });
    // Also update in dailyLogs array
    set((s) => ({
      dailyLogs: s.dailyLogs.map((l) => (l.id === log.id ? updated : l)),
    }));
    get().saveToDisk();

    // ── Record behavioral signal for memory system ──
    if (targetTask) {
      if (!targetTask.completed) {
        // Was uncompleted, now completing
        recordTaskCompleted(
          targetTask.title,
          targetTask.category,
          targetTask.durationMinutes,
          targetTask.durationMinutes // actual = estimated for now
        ).catch(() => {});
      }
      // Note: unchecking a completed task is not tracked
    }
  },

  // ── Snooze / Skip / Timer ──
  snoozeTask: (taskId) => {
    const log = get().todayLog;
    if (!log) return;
    const target = log.tasks.find((t) => t.id === taskId);
    if (!target) return;
    const tasks = log.tasks.map((t) =>
      t.id === taskId
        ? { ...t, snoozedCount: (t.snoozedCount ?? 0) + 1 }
        : t
    );
    const updated = { ...log, tasks };
    set({ todayLog: updated });
    set((s) => ({
      dailyLogs: s.dailyLogs.map((l) => (l.id === log.id ? updated : l)),
    }));
    get().saveToDisk();
    recordTaskSnoozed(target.title, target.category, new Date().toISOString()).catch(() => {});
  },

  skipTask: (taskId) => {
    const log = get().todayLog;
    if (!log) return;
    const target = log.tasks.find((t) => t.id === taskId);
    if (!target) return;
    const tasks = log.tasks.map((t) =>
      t.id === taskId ? { ...t, skipped: true } : t
    );
    const updated = { ...log, tasks };
    set({ todayLog: updated });
    set((s) => ({
      dailyLogs: s.dailyLogs.map((l) => (l.id === log.id ? updated : l)),
    }));
    get().saveToDisk();
    recordTaskSkipped(target.title, target.category, "user_skipped").catch(() => {});
  },

  startTaskTimer: (taskId) => {
    const log = get().todayLog;
    if (!log) return;
    const tasks = log.tasks.map((t) =>
      t.id === taskId ? { ...t, startedAt: new Date().toISOString() } : t
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
      t.id === taskId
        ? { ...t, actualMinutes, startedAt: undefined }
        : t
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
      actualMinutes
    ).catch(() => {});
  },

  // ── Heatmap ──
  heatmapData: [],
  setHeatmapData: (data) => set({ heatmapData: data }),

  // ── Mood ──
  moodEntries: [],
  addMoodEntry: (entry) => {
    set((s) => ({ moodEntries: [...s.moodEntries, entry] }));
    get().saveToDisk();
  },

  // ── Loading ──
  isLoading: false,
  setLoading: (v) => set({ isLoading: v }),
  error: null,
  setError: (e) => set({ error: e }),

  // ── Active Jobs ──
  activeJobs: {},
  setActiveJob: (jobId, info) =>
    set((s) => ({ activeJobs: { ...s.activeJobs, [jobId]: info } })),
  clearActiveJob: (jobId) =>
    set((s) => {
      const { [jobId]: _, ...rest } = s.activeJobs;
      return { activeJobs: rest };
    }),

  // ── Memory ──
  memorySummary: null,
  refreshMemorySummary: async () => {
    try {
      const result = await window.electronAPI.invoke("memory:summary");
      const r = result as { ok: boolean; data?: MemorySummary };
      if (r.ok && r.data) {
        set({ memorySummary: r.data });
      }
    } catch {
      console.warn("Could not load memory summary");
    }
  },

  // ── Contextual Nudges ──
  nudges: [],
  refreshNudges: async () => {
    const log = get().todayLog;
    if (!log) return;
    try {
      const nudges = await getNudges(log.tasks);
      set({ nudges });
    } catch {
      console.warn("Could not load nudges");
    }
  },
  dismissNudge: (nudgeId) => {
    set((s) => ({
      nudges: s.nudges.map((n) =>
        n.id === nudgeId ? { ...n, dismissed: true } : n
      ),
    }));
  },
  respondToNudge: (nudgeId, feedbackValue, isPositive) => {
    const nudge = get().nudges.find((n) => n.id === nudgeId);
    if (!nudge) return;
    set((s) => ({
      nudges: s.nudges.map((n) =>
        n.id === nudgeId ? { ...n, dismissed: true } : n
      ),
    }));
    recordFeedback(nudge.context, feedbackValue, isPositive).catch(() => {});
  },

  // ── Pending Tasks ──
  pendingTasks: [],
  addPendingTask: (task) => {
    set((s) => ({ pendingTasks: [...s.pendingTasks, task] }));
    get().saveToDisk();
  },
  updatePendingTask: (id, updates) => {
    set((s) => ({
      pendingTasks: s.pendingTasks.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      ),
    }));
    get().saveToDisk();
  },
  removePendingTask: (id) => {
    set((s) => ({ pendingTasks: s.pendingTasks.filter((t) => t.id !== id) }));
    get().saveToDisk();
  },
  confirmPendingTask: (id) => {
    const task = get().pendingTasks.find((t) => t.id === id);
    if (!task || !task.analysis) return;

    const todayLog = get().todayLog;
    const today = new Date().toISOString().split("T")[0];

    // ── Cognitive budget enforcement (psychological principles) ──
    // Max 12 cognitive points/day, max 5 daily tasks, 3-hour deep-work ceiling
    const existingTasks = todayLog?.tasks || [];
    const currentWeight = existingTasks.reduce((sum, t) => sum + (t.cognitiveWeight || 3), 0);
    const currentMinutes = existingTasks.reduce((sum, t) => sum + (t.durationMinutes || 30), 0);
    const dailyTaskCount = existingTasks.filter((t) => t.priority === "must-do" || t.priority === "should-do").length;

    const maxBudget = 12;
    const maxDailyTasks = 5; // decision fatigue threshold
    const maxDeepMinutes = 180; // 3-hour ceiling

    // Determine if this should be a daily task or bonus
    // If adding it would exceed cognitive budget, task count, or deep-work time → bonus
    const taskWeight = task.analysis.cognitiveWeight || 3;
    const taskMinutes = task.analysis.durationMinutes || 30;
    const isScheduledToday = task.analysis.suggestedDate === today;

    let finalPriority = task.analysis.priority;

    if (isScheduledToday) {
      const wouldExceedBudget = (currentWeight + taskWeight) > maxBudget;
      const wouldExceedTasks = dailyTaskCount >= maxDailyTasks;
      const wouldExceedTime = (currentMinutes + taskMinutes) > maxDeepMinutes;

      if (wouldExceedBudget || wouldExceedTasks || wouldExceedTime) {
        // Downgrade to bonus — don't overload the user
        finalPriority = "bonus";
      }
    }

    const newTask: import("../types").DailyTask = {
      id: `task-confirmed-${Date.now()}`,
      title: task.analysis.title,
      description: task.analysis.description,
      durationMinutes: task.analysis.durationMinutes,
      cognitiveWeight: task.analysis.cognitiveWeight,
      priority: finalPriority,
      category: task.analysis.category,
      whyToday: task.analysis.reasoning,
      progressContribution: "Quick task added via chat",
      completed: false,
      isMomentumTask: false,
    };

    if (todayLog) {
      const updated = { ...todayLog, tasks: [...todayLog.tasks, newTask] };
      set({ todayLog: updated });
      set((s) => ({
        dailyLogs: s.dailyLogs.map((l) => (l.id === todayLog.id ? updated : l)),
      }));
    } else {
      // No today log yet — create a minimal one
      const newLog: import("../types").DailyLog = {
        id: `log-${Date.now()}`,
        userId: get().user?.id || "",
        date: today,
        tasks: [newTask],
        heatmapEntry: { date: today, completionLevel: 0, currentStreak: 0, totalActiveDays: 0, longestStreak: 0 },
        notificationBriefing: "",
        milestoneCelebration: null,
        progress: { overallPercent: 0, milestonePercent: 0, currentMilestone: "", projectedCompletion: "", daysAheadOrBehind: 0 },
        yesterdayRecap: null,
        encouragement: "",
        createdAt: new Date().toISOString(),
      };
      set({ todayLog: newLog });
      set((s) => ({ dailyLogs: [...s.dailyLogs, newLog] }));
    }

    // Remove from pending
    set((s) => ({
      pendingTasks: s.pendingTasks.filter((t) => t.id !== id),
    }));
    get().saveToDisk();
    recordSignal("task_confirmed", "quick_task", `${task.analysis.title} [${finalPriority}]`).catch(() => {});
  },

  // ── Home Chat ──
  homeChatMessages: [],
  addHomeChatMessage: (msg) => {
    set((s) => ({ homeChatMessages: [...s.homeChatMessages, msg] }));
    get().saveToDisk();
    if (msg.role === "user") {
      recordSignal("chat_message", "home_chat", msg.content.slice(0, 100)).catch(() => {});
    }
  },
  clearHomeChat: () => {
    set({ homeChatMessages: [] });
    get().saveToDisk();
  },

  // ── Persistence via Electron IPC ──
  loadFromDisk: async () => {
    try {
      const data = await window.electronAPI.invoke("store:load");
      if (!data || typeof data !== "object") {
        // Empty or invalid → first launch → stay on "welcome"
        return;
      }

      const d = data as Record<string, unknown>;
      const userObj = d.user as UserProfile | undefined;

      // ── 1. No user record at all → first launch ──
      if (!userObj) {
        // Stay on "welcome" (the default currentView)
        return;
      }

      // ── 2. Hydrate all persisted state ──
      // Backfill language for users created before i18n was added
      if (!userObj.settings.language) {
        userObj.settings.language = "en";
      }
      set({ user: userObj });

      if (d.roadmap) set({ roadmap: d.roadmap as Roadmap });
      if (d.goalBreakdown)
        set({ goalBreakdown: d.goalBreakdown as GoalBreakdown });
      if (d.goals) {
        const goals = (d.goals as Goal[]).map((g) => ({
          ...g,
          flatPlan: g.flatPlan ?? null,
          plan: g.plan && typeof g.plan === "object" && !Array.isArray(g.plan) && Array.isArray((g.plan as GoalPlan).years)
            ? g.plan
            : null,
          goalType: g.goalType ?? (g.scope === "big" ? "big" : "everyday") as import("../types").GoalType,
          repeatSchedule: g.repeatSchedule ?? null,
        }));
        set({ goals });
      }
      if (d.calendarEvents)
        set({ calendarEvents: d.calendarEvents as CalendarEvent[] });
      if (d.deviceIntegrations)
        set({ deviceIntegrations: d.deviceIntegrations as DeviceIntegrations });
      if (d.dailyLogs) set({ dailyLogs: d.dailyLogs as DailyLog[] });
      if (d.heatmapData)
        set({ heatmapData: d.heatmapData as HeatmapEntry[] });
      if (d.moodEntries)
        set({ moodEntries: d.moodEntries as MoodEntry[] });
      if (d.conversations)
        set({ conversations: d.conversations as ConversationMessage[] });
      if (d.pendingTasks)
        set({ pendingTasks: d.pendingTasks as PendingTask[] });
      if (d.homeChatMessages)
        set({ homeChatMessages: d.homeChatMessages as HomeChatMessage[] });
      if (d.vacationMode)
        set({ vacationMode: d.vacationMode as { active: boolean; startDate: string; endDate: string } });
      if (d.monthlyContexts)
        set({ monthlyContexts: d.monthlyContexts as MonthlyContext[] });

      // ── 3. Decide initial view ──
      if (userObj.onboardingComplete) {
        // Fully onboarded user → dashboard
        set({ currentView: "dashboard" });
      } else {
        // User record exists but onboarding never finished → resume onboarding
        set({ currentView: "onboarding" });
      }

      // Also load memory summary
      get().refreshMemorySummary();
    } catch {
      console.warn("Could not load data from disk");
    }
  },
  saveToDisk: async () => {
    const s = get();
    try {
      await window.electronAPI.invoke("store:save", {
        user: s.user,
        roadmap: s.roadmap,
        goalBreakdown: s.goalBreakdown,
        goals: s.goals,
        calendarEvents: s.calendarEvents,
        deviceIntegrations: s.deviceIntegrations,
        dailyLogs: s.dailyLogs,
        heatmapData: s.heatmapData,
        moodEntries: s.moodEntries,
        conversations: s.conversations,
        pendingTasks: s.pendingTasks,
        homeChatMessages: s.homeChatMessages,
        vacationMode: s.vacationMode,
        monthlyContexts: s.monthlyContexts,
      });
    } catch {
      console.warn("Could not save data to disk");
    }
  },
  resetGoalData: async () => {
    // Wipe everything — return to a truly fresh state
    set({
      user: null,
      goals: [],
      roadmap: null,
      goalBreakdown: null,
      dailyLogs: [],
      todayLog: null,
      heatmapData: [],
      moodEntries: [],
      conversations: [],
      pendingTasks: [],
      homeChatMessages: [],
      vacationMode: null,
      monthlyContexts: [],
      nudges: [],
      currentView: "welcome",
    });
    await get().saveToDisk();
  },
}));

export default useStore;
