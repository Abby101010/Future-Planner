import type { ReactNode } from "react";
import type { AppView } from "@starward/core";

import CalendarPage from "../pages/calendar/CalendarPage";
import GoalPlanPage from "../pages/goals/GoalPlanPage";
import SettingsPage from "../pages/settings/SettingsPage";
import PlanningPage from "../pages/goals/PlanningPage";
import TasksPage from "../pages/tasks/TasksPage";
import NewsFeedPage from "../pages/news/NewsFeedPage";

export function renderView(view: AppView): ReactNode {
  if (view.startsWith("goal-plan-")) {
    return <GoalPlanPage goalId={view.replace("goal-plan-", "")} />;
  }
  switch (view) {
    case "planning":
      return <PlanningPage />;
    case "tasks":
      return <TasksPage />;
    case "calendar":
      return <CalendarPage />;
    case "news-feed":
      return <NewsFeedPage />;
    case "settings":
      return <SettingsPage />;
    default:
      return null;
  }
}
