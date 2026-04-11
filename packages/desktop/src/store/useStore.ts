/* ──────────────────────────────────────────────────────────
   NorthStar — Zustand application store (Phase 7 minimal)

   After Phase 7 the store holds ONLY ephemeral UI state that
   doesn't belong on the server. Domain data (goals, logs,
   calendar, chat, user profile, settings, etc.) is served by
   `view:*` queries via `useQuery` and mutated via `useCommand`.

   KEEP THIS FILE THIN. If you're tempted to add a `goals`
   array or a `todayLog` here, stop — add a field to the
   relevant server view instead.
   ────────────────────────────────────────────────────────── */

import { create } from "zustand";
import type { AppView } from "@northstar/core";

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
}

const useStore = create<StoreApi>((set) => ({
  currentView: "welcome",
  setView: (view) => set({ currentView: view }),

  activeChatId: null,
  setActiveChatId: (id) => set({ activeChatId: id }),

  language: "en",
  setLanguage: (language) => set({ language }),
}));

export default useStore;
