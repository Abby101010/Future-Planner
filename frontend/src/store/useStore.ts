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

  /** Per-page chat is auto-routed via `currentView`: goal-plan-* views
   *  scope chat to that goal, anything else uses general/home mode.
   *  Setting this to "general" overrides the auto-route so the user
   *  can talk to home chat while sitting on a Goal Plan page. Set to
   *  null (default) to follow the page. The override clears whenever
   *  `currentView` changes (handled in setView). */
  chatModeOverride: "general" | null;
  setChatModeOverride: (mode: "general" | null) => void;

  /** Sidebar collapse (64px icons-only vs. 224px). */
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;

  /** Two-tier floating Settings dialog (opens from sidebar profile click). */
  isSettingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
}

const useStore = create<StoreApi>((set) => ({
  currentView: "welcome",
  // Clear the chat mode override on every navigation so leaving a Goal
  // Plan page (or jumping to one) doesn't carry a stale override.
  setView: (view) => set({ currentView: view, chatModeOverride: null }),

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

  chatModeOverride: null,
  setChatModeOverride: (mode) => set({ chatModeOverride: mode }),

  isSidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ isSidebarCollapsed: !s.isSidebarCollapsed })),

  isSettingsOpen: false,
  setSettingsOpen: (open) => set({ isSettingsOpen: open }),
}));

export default useStore;
