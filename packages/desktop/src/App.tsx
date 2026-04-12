/* ──────────────────────────────────────────────────────────
   NorthStar (北极星) — Root application shell
   ────────────────────────────────────────────────────────── */

import { useEffect } from "react";
import useStore from "./store/useStore";
import { wsClient } from "./services/wsClient";
import { I18nProvider } from "./i18n";
import { useQuery } from "./hooks/useQuery";
import Sidebar from "./components/Sidebar";
import Chat from "./components/Chat";
import ErrorBoundary from "./components/ErrorBoundary";
import WelcomePage from "./pages/welcome/WelcomePage";
import OnboardingPage from "./pages/onboarding/OnboardingPage";
import CalendarPage from "./pages/calendar/CalendarPage";
import GoalPlanPage from "./pages/goals/GoalPlanPage";
import RoadmapPage from "./pages/roadmap/RoadmapPage";
import SettingsPage from "./pages/settings/SettingsPage";
import PlanningPage from "./pages/goals/PlanningPage";
import TasksPage from "./pages/tasks/TasksPage";
import NewsFeedPage from "./pages/news/NewsFeedPage";
import "./styles/global.css";
import "./App.css";

// Minimal projection of view:onboarding used solely to seed language +
// decide whether to boot into onboarding or dashboard on first render.
interface OnboardingBootView {
  user: {
    settings?: { language?: "en" | "zh" };
    onboardingComplete?: boolean;
  } | null;
  onboardingComplete: boolean;
}

function App() {
  const currentView = useStore((s) => s.currentView);
  const setView = useStore((s) => s.setView);
  const language = useStore((s) => s.language);
  const setLanguage = useStore((s) => s.setLanguage);

  // One-shot boot query: read the user + onboardingComplete so we can
  // seed language and jump into dashboard vs. onboarding. After this
  // settles we never touch it again; pages fetch their own views.
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

  // Phase 5b: single top-level WebSocket subscription. Individual hooks
  // (useQuery, useWsEvent, useAiStream) register listeners against this
  // shared connection; here we just manage its lifecycle.
  useEffect(() => {
    wsClient.connect();
    return () => {
      wsClient.disconnect();
    };
  }, []);

  const showSidebar =
    currentView === "planning" ||
    currentView === "tasks" ||
    currentView === "calendar" ||
    currentView === "roadmap" ||
    currentView === "settings" ||
    currentView === "news-feed" ||
    currentView.startsWith("goal-plan-");

  const goalPlanId = currentView.startsWith("goal-plan-")
    ? currentView.replace("goal-plan-", "")
    : null;

  return (
    <I18nProvider language={language}>
    <div className="app-shell">
      {/* macOS drag region */}
      <div className="drag-region" />

      {showSidebar && <Sidebar />}
      {showSidebar && <Chat />}

      <main className={`app-main ${showSidebar ? "app-main--with-sidebar" : ""}`}>
        <ErrorBoundary>
          {currentView === "welcome" && <WelcomePage />}
          {currentView === "onboarding" && <OnboardingPage />}
          {currentView === "planning" && <PlanningPage />}
          {currentView === "tasks" && <TasksPage />}
          {currentView === "calendar" && <CalendarPage />}
          {goalPlanId && <GoalPlanPage goalId={goalPlanId} />}
          {currentView === "roadmap" && <RoadmapPage />}
          {currentView === "news-feed" && <NewsFeedPage />}
          {currentView === "settings" && <SettingsPage />}
        </ErrorBoundary>
      </main>
    </div>
    </I18nProvider>
  );
}

export default App;
