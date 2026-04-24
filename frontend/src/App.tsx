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
import Sidebar from "./components/Sidebar";
import ErrorBoundary from "./components/ErrorBoundary";

// Floating chrome
import FloatingChat from "./components/chrome/FloatingChat";
import ChatFab from "./components/chrome/ChatFab";
import JobStatusDock from "./components/chrome/JobStatusDock";
import WsIndicator from "./components/chrome/WsIndicator";
import SettingsDialog from "./components/settings/SettingsDialog";

// Pages
import OnboardingPage from "./pages/onboarding/OnboardingPage";
import CalendarPage from "./pages/calendar/CalendarPage";
import GoalPlanPage from "./pages/goals/GoalPlanPage";
import RoadmapPage from "./pages/roadmap/RoadmapPage";
import SettingsPage from "./pages/settings/SettingsPage";
import PlanningPage from "./pages/goals/PlanningPage";
import TasksPage from "./pages/tasks/TasksPage";
import NewsFeedPage from "./pages/news/NewsFeedPage";

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
  const setView = useStore((s) => s.setView);
  const language = useStore((s) => s.language);
  const setLanguage = useStore((s) => s.setLanguage);

  const { data: boot } = useQuery<OnboardingBootView>("view:onboarding");
  useEffect(() => {
    if (!boot) return;
    const lang = boot.user?.settings?.language;
    if (lang && lang !== language) setLanguage(lang);
    if (currentView === "welcome") {
      setView(boot.onboardingComplete ? "tasks" : "onboarding");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot]);

  useEffect(() => {
    wsClient.connect();
    return () => {
      wsClient.disconnect();
    };
  }, []);

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

  const goalPlanId = currentView.startsWith("goal-plan-")
    ? currentView.replace("goal-plan-", "")
    : null;

  return (
    <I18nProvider language={language}>
      <div className="app-shell" data-testid="app-shell">
        <Sidebar />
        <main className="app-main" data-testid="app-main">
          <ErrorBoundary>
            {currentView === "planning" && <PlanningPage />}
            {currentView === "tasks" && <TasksPage />}
            {currentView === "calendar" && <CalendarPage />}
            {goalPlanId && <GoalPlanPage goalId={goalPlanId} />}
            {currentView === "roadmap" && <RoadmapPage />}
            {currentView === "news-feed" && <NewsFeedPage />}
            {currentView === "settings" && <SettingsPage />}
          </ErrorBoundary>
        </main>

        {/* Global floating chrome — only in the main app, never in gated flows. */}
        <SettingsDialog />
        <FloatingChat />
        <ChatFab />
        <JobStatusDock />
        <WsIndicator />
      </div>
    </I18nProvider>
  );
}

export default App;
