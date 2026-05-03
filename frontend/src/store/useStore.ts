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
import { persist, createJSONStorage } from "zustand/middleware";
import type { AppView } from "@starward/core";

export type Language = "en" | "zh";

export type PaneId = "left" | "right";

interface StoreApi {
  /** The currently-rendered top-level view. Drives App.tsx routing.
   *  In split mode, this is the LEFT pane's view. */
  currentView: AppView;
  setView: (view: AppView) => void;

  /** Right pane view when split mode is active. null = single-pane. */
  rightPaneView: AppView | null;
  /** Which pane sidebar clicks/keyboard nav target. Always "left" in
   *  single-pane mode. */
  activePane: PaneId;
  /** Split divider position (left-pane fraction), clamped 0.3..0.7. */
  dividerRatio: number;

  /** Open `view` in the given pane. Promotes to split mode if the right
   *  pane was empty. No-op if `view` is already in the OTHER pane (the
   *  drop-on-duplicate guard). */
  openInPane: (view: AppView, pane: PaneId) => void;
  /** Close the given pane and collapse to single-pane with the survivor.
   *  No-op if already single-pane. */
  closePane: (pane: PaneId) => void;
  /** Set divider position; clamped to [0.3, 0.7]. */
  setDividerRatio: (ratio: number) => void;
  /** Mark which pane has focus. Ignored if pane is empty. */
  setActivePane: (pane: PaneId) => void;

  /** While the user is dragging a sidebar entry, this holds the view id
   *  being dragged. Drives the DropZoneOverlay visibility and the
   *  pre-drop visual hints. null when no drag is in flight. */
  draggedView: AppView | null;
  startSidebarDrag: (view: AppView) => void;
  endSidebarDrag: () => void;

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

  /** Sidebar collapse (64px icons-only vs. 224px). Default true: the
   *  sidebar rests collapsed and expands on cursor hover. Setting this
   *  to false "pins" the sidebar open, ignoring hover. The toggle
   *  button switches between the two modes. */
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;

  /** Two-tier floating Settings dialog (opens from sidebar profile click). */
  isSettingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
}

const DIVIDER_MIN = 0.3;
const DIVIDER_MAX = 0.7;
const clampRatio = (r: number) => Math.max(DIVIDER_MIN, Math.min(DIVIDER_MAX, r));

const GATE_VIEWS = new Set<AppView>(["welcome", "onboarding", "login"]);

const useStore = create<StoreApi>()(persist((set) => ({
  currentView: "welcome",
  // Clear the chat mode override on every navigation so leaving a Goal
  // Plan page (or jumping to one) doesn't carry a stale override.
  // In split mode with the right pane active, route the view there
  // instead of stomping the left pane.
  setView: (view) =>
    set((s) => {
      if (s.rightPaneView !== null && s.activePane === "right") {
        return { rightPaneView: view, chatModeOverride: null };
      }
      return { currentView: view, chatModeOverride: null };
    }),

  rightPaneView: null,
  activePane: "left",
  dividerRatio: 0.5,

  openInPane: (view, pane) =>
    set((s) => {
      // Don't duplicate: no-op if `view` is already in the OTHER pane.
      const otherView = pane === "left" ? s.rightPaneView : s.currentView;
      if (otherView === view) return {};
      // No-op if `view` is already in the SAME pane (defensive — sidebar
      // also disables drag for already-open views).
      const samePaneView = pane === "left" ? s.currentView : s.rightPaneView;
      if (samePaneView === view) return {};

      if (pane === "right") {
        // Single-pane: existing left stays, new view becomes right.
        // Already split: replace right only.
        return { rightPaneView: view, activePane: "right", chatModeOverride: null };
      }

      // pane === "left"
      if (s.rightPaneView !== null) {
        // Already split: replace left only, preserve right.
        return { currentView: view, activePane: "left", chatModeOverride: null };
      }
      // Single-pane → split: push existing view to the right pane and put
      // the new view on the left. Per the spec: "If they drop on the left
      // half, the new content takes the left side and the existing content
      // moves to the right."
      return {
        currentView: view,
        rightPaneView: s.currentView,
        activePane: "left",
        chatModeOverride: null,
      };
    }),

  closePane: (pane) =>
    set((s) => {
      if (s.rightPaneView === null) return {};
      if (pane === "right") {
        return { rightPaneView: null, activePane: "left" };
      }
      return { currentView: s.rightPaneView, rightPaneView: null, activePane: "left" };
    }),

  setDividerRatio: (ratio) => set({ dividerRatio: clampRatio(ratio) }),

  setActivePane: (pane) =>
    set((s) => {
      if (pane === "right" && s.rightPaneView === null) return {};
      return { activePane: pane };
    }),

  draggedView: null,
  startSidebarDrag: (view) => set({ draggedView: view }),
  endSidebarDrag: () => set({ draggedView: null }),

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

  isSidebarCollapsed: true,
  toggleSidebar: () => set((s) => ({ isSidebarCollapsed: !s.isSidebarCollapsed })),

  isSettingsOpen: false,
  setSettingsOpen: (open) => set({ isSettingsOpen: open }),
}), {
  name: "northstar.layout.v1",
  storage: createJSONStorage(() => localStorage),
  // Only persist split layout. Skip during gated flows (welcome/onboarding/
  // login) so the boot effect always runs cleanly on first load. In
  // single-pane mode we persist the divider ratio only — currentView falls
  // back to its in-memory default ("welcome") so onboarding and gate logic
  // re-run on cold start.
  partialize: (state) => {
    if (GATE_VIEWS.has(state.currentView)) {
      return { dividerRatio: state.dividerRatio };
    }
    if (state.rightPaneView) {
      return {
        currentView: state.currentView,
        rightPaneView: state.rightPaneView,
        dividerRatio: state.dividerRatio,
      };
    }
    return { dividerRatio: state.dividerRatio };
  },
  version: 1,
}));

export default useStore;
