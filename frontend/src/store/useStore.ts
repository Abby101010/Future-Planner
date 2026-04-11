/* ──────────────────────────────────────────────────────────
   NorthStar — Zustand application store

   The bulky domain slices (planning, dailyLogs, chat, calendar)
   live under ./slices/*. Everything else — view, user, memory,
   nudges, reminders, UI, persistence — stays inline here since
   it's small and tightly coupled to loadFromDisk/saveToDisk.
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
  UserSettings,
  MemorySummary,
  ContextualNudge,
  Goal,
  PendingTask,
  Reminder,
} from "../types";
import {
  recordFeedback,
  recordSignal,
  getNudges,
} from "../services/memory";
import { memoryRepo, reminderRepo, chatRepo, appDataRepo } from "../repositories";
import {
  createPlanningSlice,
  type PlanningSlice,
} from "./slices/planning";
import {
  createDailyLogsSlice,
  type DailyLogsSlice,
} from "./slices/dailyLogs";
import { createChatSlice, type ChatSlice } from "./slices/chat";
import { createCalendarSlice, type CalendarSlice } from "./slices/calendar";

// ── Non-slice (core) state ─────────────────────────────
interface CoreSlice {
  currentView: AppView;
  setView: (view: AppView) => void;

  user: UserProfile | null;
  setUser: (user: UserProfile) => void;
  updateSettings: (settings: Partial<UserSettings>) => void;

  conversations: ConversationMessage[];
  addMessage: (msg: ConversationMessage) => void;
  clearConversation: () => void;

  isLoading: boolean;
  setLoading: (v: boolean) => void;
  error: string | null;
  setError: (e: string | null) => void;

  activeJobs: Record<
    string,
    { type: string; status: string; progress: number }
  >;
  setActiveJob: (
    jobId: string,
    info: { type: string; status: string; progress: number },
  ) => void;
  clearActiveJob: (jobId: string) => void;

  memorySummary: MemorySummary | null;
  refreshMemorySummary: () => Promise<void>;

  nudges: ContextualNudge[];
  refreshNudges: () => Promise<void>;
  dismissNudge: (nudgeId: string) => void;
  respondToNudge: (
    nudgeId: string,
    feedbackValue: string,
    isPositive: boolean,
  ) => void;

  reminders: Reminder[];
  addReminder: (reminder: Reminder) => void;
  acknowledgeReminder: (id: string) => void;
  removeReminder: (id: string) => void;

  loadFromDisk: () => Promise<void>;
  saveToDisk: () => Promise<void>;
  resetGoalData: () => Promise<void>;
}

export type StoreApi = CoreSlice &
  PlanningSlice &
  DailyLogsSlice &
  ChatSlice &
  CalendarSlice;

const useStore = create<StoreApi>((set, get, store) => ({
  ...createPlanningSlice(set, get, store),
  ...createDailyLogsSlice(set, get, store),
  ...createChatSlice(set, get, store),
  ...createCalendarSlice(set, get, store),

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

  // ── Loading / errors ──
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
      const summary = await memoryRepo.getSummary();
      if (summary) set({ memorySummary: summary });
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
        n.id === nudgeId ? { ...n, dismissed: true } : n,
      ),
    }));
  },
  respondToNudge: (nudgeId, feedbackValue, isPositive) => {
    const nudge = get().nudges.find((n) => n.id === nudgeId);
    if (!nudge) return;
    set((s) => ({
      nudges: s.nudges.map((n) =>
        n.id === nudgeId ? { ...n, dismissed: true } : n,
      ),
    }));
    recordFeedback(nudge.context, feedbackValue, isPositive).catch(() => {});
  },

  // ── Reminders ──
  reminders: [],
  addReminder: (reminder) => {
    set((s) => ({ reminders: [...s.reminders, reminder] }));
    get().saveToDisk();
    reminderRepo.upsert(reminder).catch(() => {});
    recordSignal("reminder_created", "reminder", reminder.title).catch(() => {});
  },
  acknowledgeReminder: (id) => {
    set((s) => ({
      reminders: s.reminders.map((r) =>
        r.id === id
          ? {
              ...r,
              acknowledged: true,
              acknowledgedAt: new Date().toISOString(),
            }
          : r,
      ),
    }));
    get().saveToDisk();
    reminderRepo.acknowledge(id).catch(() => {});
  },
  removeReminder: (id) => {
    set((s) => ({ reminders: s.reminders.filter((r) => r.id !== id) }));
    get().saveToDisk();
    reminderRepo.delete(id).catch(() => {});
  },

  // ── Persistence via Electron IPC ──
  loadFromDisk: async () => {
    try {
      const data = await appDataRepo.load();
      if (!data || typeof data !== "object") return;

      const d = data as Record<string, unknown>;
      const userObj = d.user as UserProfile | undefined;

      if (!userObj) return;

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
          plan:
            g.plan &&
            typeof g.plan === "object" &&
            !Array.isArray(g.plan) &&
            Array.isArray((g.plan as { years?: unknown }).years)
              ? g.plan
              : null,
          goalType:
            g.goalType ??
            ((g.scope === "big"
              ? "big"
              : "everyday") as import("../types").GoalType),
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
      if (d.conversations)
        set({ conversations: d.conversations as ConversationMessage[] });
      if (d.pendingTasks)
        set({ pendingTasks: d.pendingTasks as PendingTask[] });

      try {
        const sessions = await chatRepo.listSessions();
        if (sessions.length) set({ chatSessions: sessions });
      } catch {
        /* chat sessions are optional */
      }

      try {
        const rawReminders = (await reminderRepo.list()) as unknown as Array<
          Record<string, unknown>
        >;
        const reminders: Reminder[] = rawReminders.map((r) => ({
          id: r.id as string,
          title: r.title as string,
          description: ((r.description as string) || "") as string,
          reminderTime: ((r.reminder_time as string) ||
            (r.reminderTime as string)) as string,
          date: r.date as string,
          acknowledged: !!r.acknowledged,
          acknowledgedAt:
            (r.acknowledged_at as string) ||
            (r.acknowledgedAt as string) ||
            undefined,
          repeat: (r.repeat || null) as Reminder["repeat"],
          source: ((r.source as string) || "chat") as Reminder["source"],
          createdAt:
            (r.created_at as string) ||
            (r.createdAt as string) ||
            new Date().toISOString(),
        }));
        if (reminders.length) set({ reminders });
      } catch {
        /* reminders are optional */
      }

      if (d.vacationMode)
        set({
          vacationMode: d.vacationMode as {
            active: boolean;
            startDate: string;
            endDate: string;
          },
        });
      if (d.monthlyContexts)
        set({ monthlyContexts: d.monthlyContexts as MonthlyContext[] });

      if (userObj.onboardingComplete) {
        set({ currentView: "dashboard" });
      } else {
        set({ currentView: "onboarding" });
      }

      get().refreshMemorySummary();
    } catch {
      console.warn("Could not load data from disk");
    }
  },
  saveToDisk: async () => {
    const s = get();
    try {
      await appDataRepo.save({
        user: s.user,
        roadmap: s.roadmap,
        goalBreakdown: s.goalBreakdown,
        goals: s.goals,
        calendarEvents: s.calendarEvents,
        deviceIntegrations: s.deviceIntegrations,
        dailyLogs: s.dailyLogs,
        heatmapData: s.heatmapData,
        conversations: s.conversations,
        pendingTasks: s.pendingTasks,
        vacationMode: s.vacationMode,
        monthlyContexts: s.monthlyContexts,
      });
    } catch {
      console.warn("Could not save data to disk");
    }
  },
  resetGoalData: async () => {
    set({
      user: null,
      goals: [],
      roadmap: null,
      goalBreakdown: null,
      dailyLogs: [],
      todayLog: null,
      heatmapData: [],
      conversations: [],
      pendingTasks: [],
      reminders: [],
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
