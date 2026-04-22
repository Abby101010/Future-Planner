/* NorthStar client test harness — bare HTML shell. */

import { useEffect } from "react";
import useStore from "./store/useStore";
import { wsClient } from "./services/wsClient";
import { I18nProvider } from "./i18n";
import { AuthProvider } from "./contexts/AuthContext";
import AuthGuard from "./components/AuthGuard";
import { useQuery } from "./hooks/useQuery";
import Sidebar from "./components/Sidebar";
import Chat from "./components/Chat";
import ErrorBoundary from "./components/ErrorBoundary";
import OnboardingPage from "./pages/onboarding/OnboardingPage";
import CalendarPage from "./pages/calendar/CalendarPage";
import GoalPlanPage from "./pages/goals/GoalPlanPage";
import RoadmapPage from "./pages/roadmap/RoadmapPage";
import SettingsPage from "./pages/settings/SettingsPage";
import PlanningPage from "./pages/goals/PlanningPage";
import TasksPage from "./pages/tasks/TasksPage";
import NewsFeedPage from "./pages/news/NewsFeedPage";
import DashboardPage from "./pages/dashboard/DashboardPage";
import GoalBreakdownPage from "./pages/goals/GoalBreakdownPage";
import MemoryPage from "./pages/memory/MemoryPage";
import ChatSessionsPage from "./pages/chat/ChatSessionsPage";

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

  const goalPlanId = currentView.startsWith("goal-plan-")
    ? currentView.replace("goal-plan-", "")
    : null;

  return (
    <I18nProvider language={language}>
      <div className="app-shell" data-testid="app-shell">
        <div className="app-sidebar" data-testid="app-sidebar">
          <Sidebar />
        </div>
        <main className="app-main" data-testid="app-main">
          <ErrorBoundary>
            {currentView === "welcome" && <p data-testid="app-booting">booting…</p>}
            {currentView === "onboarding" && <OnboardingPage />}
            {currentView === "planning" && <PlanningPage />}
            {currentView === "tasks" && <TasksPage />}
            {currentView === "calendar" && <CalendarPage />}
            {currentView === "dashboard" && <DashboardPage />}
            {currentView === "goal-breakdown" && <GoalBreakdownPage />}
            {currentView === "memory" && <MemoryPage />}
            {currentView === "chat-sessions" && <ChatSessionsPage />}
            {goalPlanId && <GoalPlanPage goalId={goalPlanId} />}
            {currentView === "roadmap" && <RoadmapPage />}
            {currentView === "news-feed" && <NewsFeedPage />}
            {currentView === "settings" && <SettingsPage />}
          </ErrorBoundary>
        </main>
        <div className="app-chat" data-testid="app-chat">
          <Chat />
        </div>
      </div>
    </I18nProvider>
  );
}

export default App;
