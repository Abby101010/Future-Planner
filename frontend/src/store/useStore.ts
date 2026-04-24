/* ──────────────────────────────────────────────────────────
   Starward — Zustand application store (Phase 7 minimal)

   After Phase 7 the store holds ONLY ephemeral UI state that
   doesn't belong on the server. Domain data (goals, logs,
   calendar, chat, user profile, settings, etc.) is served by
   `view:*` queries via `useQuery` and mutated via `useCommand`.

   KEEP THIS FILE THIN. If you're tempted to add a `goals`
   array or a `todayLog` here, stop — add a field to the
   relevant server view instead.
   ────────────────────────────────────────────────────────── */

import { create } from "zustand";
import type { AppView } from "@starward/core";

export type Language = "en" | "zh";

interface StoreApi {
  /** The currently-rendered top-level view. Drives App.tsx routing. */
  currentView: AppView;
  setView: (view: AppView) => void;

  /** Active home chat session id — ephemeral navigation for the
   *  chat list panel on DashboardPage. */
  activeChatId: string | null;
  setActiveChatId: (id: string | null) => void;

  /** UI language. Initially seeded from the settings view once it
   *  loads; changes here are cosmetic until `command:update-settings`
   *  actually persists the choice. */
  language: Language;
  setLanguage: (lang: Language) => void;

  /** When the user asks home chat to "research X", we store the topic
   *  here so the News Feed page can run a focused research request
   *  instead of the default goal-based insights feed. Cleared after
   *  the news page consumes it. */
  researchTopic: string | null;
  setResearchTopic: (topic: string | null) => void;

  /** Whether the slide-out chat panel is open. */
  isChatOpen: boolean;
  setChatOpen: (open: boolean) => void;
  toggleChat: () => void;

  /** Pre-seeded message to auto-send when the chat panel opens. */
  pendingChatMessage: string | null;
  setPendingChatMessage: (msg: string | null) => void;

  /** Active AI chat channel — home | chat | goal-plan. Read by FloatingChat. */
  chatChannel: "home" | "chat" | "goal-plan";
  setChatChannel: (c: "home" | "chat" | "goal-plan") => void;

  /** When chat is opened for a specific goal, the goalId routes the stream
   *  to /ai/goal-plan-chat/stream. */
  chatGoalId: string;
  setChatGoalId: (id: string) => void;

  /** Sidebar collapse (64px icons-only vs. 224px). */
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;

  /** Two-tier floating Settings dialog (opens from sidebar profile click). */
  isSettingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
}

const useStore = create<StoreApi>((set) => ({
  currentView: "welcome",
  setView: (view) => set({ currentView: view }),

  activeChatId: null,
  setActiveChatId: (id) => set({ activeChatId: id }),

  language: "en",
  setLanguage: (language) => set({ language }),

  researchTopic: null,
  setResearchTopic: (topic) => set({ researchTopic: topic }),

  isChatOpen: false,
  setChatOpen: (open) => set({ isChatOpen: open }),
  toggleChat: () => set((s) => ({ isChatOpen: !s.isChatOpen })),

  pendingChatMessage: null,
  setPendingChatMessage: (msg) => set({ pendingChatMessage: msg }),

  chatChannel: "home",
  setChatChannel: (c) => set({ chatChannel: c }),

  chatGoalId: "",
  setChatGoalId: (id) => set({ chatGoalId: id }),

  isSidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ isSidebarCollapsed: !s.isSidebarCollapsed })),

  isSettingsOpen: false,
  setSettingsOpen: (open) => set({ isSettingsOpen: open }),
}));

export default useStore;
