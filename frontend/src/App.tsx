/* Starward client — designed application shell.
 *
 * Mounts the sidebar, main page content, floating chrome (FloatingChat,
 * ChatFab, JobStatusDock, WsIndicator), and the SettingsDialog popup.
 * Page content is routed by `currentView` in the Zustand store.
 */

import { useEffect } from "react";
import useStore from "./store/useStore";
import { wsClient } from "./services/wsClient";
import { I18nProvider } from "./i18n";
import { AuthProvider } from "./contexts/AuthContext";
import AuthGuard from "./components/AuthGuard";
import { useQuery } from "./hooks/useQuery";
import { useDayRollover } from "./hooks/useDayRollover";
import Sidebar from "./components/Sidebar";
import ErrorBoundary from "./components/ErrorBoundary";
import { useViewportWidth, SPLIT_MIN_WIDTH } from "./hooks/useViewportWidth";

// Floating chrome
import FloatingChat from "./components/chrome/FloatingChat";
import ChatFab from "./components/chrome/ChatFab";
import JobStatusDock from "./components/chrome/JobStatusDock";
import WsIndicator from "./components/chrome/WsIndicator";
import UpdateBadge from "./components/chrome/UpdateBadge";
import SettingsDialog from "./components/settings/SettingsDialog";

// Pages
import OnboardingPage from "./pages/onboarding/OnboardingPage";
import { renderView } from "./views/registry";
import SplitWorkspace from "./components/SplitWorkspace";
import DropZoneOverlay from "./components/DropZoneOverlay";

interface OnboardingBootView {
  user: {
    settings?: { language?: "en" | "zh" };
    onboardingComplete?: boolean;
  } | null;
  onboardingComplete: boolean;
}

function App() {
  return (
    <AuthProvider>
      <AuthGuard>
        <AppShell />
      </AuthGuard>
    </AuthProvider>
  );
}

function AppShell() {
  const currentView = useStore((s) => s.currentView);
  const rightPaneView = useStore((s) => s.rightPaneView);
  const activePane = useStore((s) => s.activePane);
  const setView = useStore((s) => s.setView);
  const closePane = useStore((s) => s.closePane);
  const language = useStore((s) => s.language);
  const setLanguage = useStore((s) => s.setLanguage);
  const viewportWidth = useViewportWidth();
  // Split mode collapses below 1024px without mutating the persisted layout
  // — the user's split returns when the window grows back. We render the
  // active pane's view in single-pane mode while collapsed.
  const splitAllowed = viewportWidth >= SPLIT_MIN_WIDTH;
  const renderSplit = splitAllowed && rightPaneView !== null;
  const collapsedView =
    !splitAllowed && rightPaneView !== null && activePane === "right"
      ? rightPaneView
      : currentView;

  const { data: boot } = useQuery<OnboardingBootView>("view:onboarding");
  useEffect(() => {
    if (!boot) return;
    const lang = boot.user?.settings?.language;
    if (lang && lang !== language) setLanguage(lang);
    if (currentView === "welcome") {
      setView(boot.onboardingComplete ? "tasks" : "onboarding");
      return;
    }
    // Defensive: if a persisted split layout would let an incomplete user
    // bypass onboarding (e.g., user A logged out, user B logs in mid-
    // onboarding), force back to onboarding and collapse the split.
    if (boot.onboardingComplete === false && currentView !== "onboarding") {
      if (rightPaneView !== null) closePane("right");
      setView("onboarding");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot]);

  useEffect(() => {
    wsClient.connect();
    return () => {
      wsClient.disconnect();
    };
  }, []);

  // Auto-refresh date-sensitive views (tasks, dashboard, calendar, goal
  // pages) when the user wakes the laptop in the morning or otherwise
  // returns to the app after the local date has flipped. See
  // hooks/useDayRollover.ts for the trigger conditions.
  useDayRollover();

  // Gated flows render full-screen with NO sidebar, NO floating chrome. The
  // sidebar is irrelevant before the user has completed onboarding, and the
  // WsIndicator flashes "view:invalidate" toasts that are distracting during
  // a guided flow. This mirrors the prototype's <PageWelcome>/<PageOnboarding>
  // render paths, which returned the page directly at the top of App.
  if (currentView === "welcome") {
    return (
      <I18nProvider language={language}>
        <div data-testid="app-booting" style={{ padding: 40, textAlign: "center" }}>
          booting…
        </div>
      </I18nProvider>
    );
  }
  if (currentView === "onboarding") {
    return (
      <I18nProvider language={language}>
        <ErrorBoundary>
          <OnboardingPage />
        </ErrorBoundary>
      </I18nProvider>
    );
  }

  return (
    <I18nProvider language={language}>
      <div className="app-shell" data-testid="app-shell">
        <Sidebar />
        <main
          className={`app-main${renderSplit ? " app-main--split" : ""}`}
          data-testid="app-main"
        >
          <ErrorBoundary>
            {renderSplit ? <SplitWorkspace /> : renderView(collapsedView)}
          </ErrorBoundary>
          {splitAllowed && <DropZoneOverlay />}
        </main>

        {/* Global floating chrome — only in the main app, never in gated flows. */}
        <SettingsDialog />
        <FloatingChat />
        <ChatFab />
        <JobStatusDock />
        <WsIndicator />
        <UpdateBadge />
      </div>
    </I18nProvider>
  );
}

export default App;
