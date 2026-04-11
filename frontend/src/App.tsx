/* ──────────────────────────────────────────────────────────
   NorthStar (北极星) — Root application shell
   ────────────────────────────────────────────────────────── */

import { useEffect } from "react";
import useStore from "./store/useStore";
import { I18nProvider } from "./i18n";
import Sidebar from "./components/Sidebar";
import WelcomePage from "./pages/WelcomePage";
import OnboardingPage from "./pages/OnboardingPage";
import DashboardPage from "./pages/DashboardPage";
import CalendarPage from "./pages/CalendarPage";
import GoalPlanPage from "./pages/GoalPlanPage";
import RoadmapPage from "./pages/RoadmapPage";
import SettingsPage from "./pages/SettingsPage";
import PlanningPage from "./pages/PlanningPage";
import TasksPage from "./pages/TasksPage";
import NewsFeedPage from "./pages/NewsFeedPage";
import "./styles/global.css";
import "./App.css";

function App() {
  const { currentView, loadFromDisk, user } = useStore();
  const language = user?.settings?.language || "en";

  useEffect(() => {
    loadFromDisk();
  }, [loadFromDisk]);

  const showSidebar =
    currentView === "dashboard" ||
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

      <main className={`app-main ${showSidebar ? "app-main--with-sidebar" : ""}`}>
        {currentView === "welcome" && <WelcomePage />}
        {currentView === "onboarding" && <OnboardingPage />}
        {currentView === "dashboard" && <DashboardPage />}
        {currentView === "planning" && <PlanningPage />}
        {currentView === "tasks" && <TasksPage />}
        {currentView === "calendar" && <CalendarPage />}
        {goalPlanId && <GoalPlanPage goalId={goalPlanId} />}
        {currentView === "roadmap" && <RoadmapPage />}
        {currentView === "news-feed" && <NewsFeedPage />}
        {currentView === "settings" && <SettingsPage />}
      </main>
    </div>
    </I18nProvider>
  );
}

export default App;
