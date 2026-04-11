/* NorthStar server — view resolvers barrel
 *
 * One entry per QueryKind. The `viewResolvers` map is the single
 * dispatch table the /view/:kind route uses to look up the right
 * resolver for an incoming request.
 *
 * Each resolver is fully typed: its return shape is declared alongside
 * the resolver itself (e.g. DashboardView, GoalPlanView) and exported
 * so route handlers can type-check payloads at the edge.
 */

import type { QueryKind } from "@northstar/core";

import {
  resolveDashboardView,
  type DashboardView,
} from "./dashboardView";
import { resolveTasksView, type TasksView } from "./tasksView";
import {
  resolveCalendarView,
  type CalendarView,
  type CalendarViewArgs,
} from "./calendarView";
import { resolveRoadmapView, type RoadmapView } from "./roadmapView";
import { resolvePlanningView, type PlanningView } from "./planningView";
import { resolveSettingsView, type SettingsView } from "./settingsView";
import { resolveNewsFeedView, type NewsFeedView } from "./newsFeedView";
import {
  resolveOnboardingView,
  type OnboardingView,
} from "./onboardingView";
import {
  resolveGoalPlanView,
  type GoalPlanView,
  type GoalPlanViewArgs,
} from "./goalPlanView";
import {
  resolveGoalBreakdownView,
  type GoalBreakdownView,
  type GoalBreakdownViewArgs,
} from "./goalBreakdownView";

export {
  resolveDashboardView,
  resolveTasksView,
  resolveCalendarView,
  resolveRoadmapView,
  resolvePlanningView,
  resolveSettingsView,
  resolveNewsFeedView,
  resolveOnboardingView,
  resolveGoalPlanView,
  resolveGoalBreakdownView,
};

export type {
  DashboardView,
  TasksView,
  CalendarView,
  CalendarViewArgs,
  RoadmapView,
  PlanningView,
  SettingsView,
  NewsFeedView,
  OnboardingView,
  GoalPlanView,
  GoalPlanViewArgs,
  GoalBreakdownView,
  GoalBreakdownViewArgs,
};

/** Dispatch table: QueryKind → resolver. Every resolver accepts an
 *  optional `args` object (strings come in off req.query so we coerce
 *  at the route boundary, not here). */
export const viewResolvers: Record<
  QueryKind,
  (args?: Record<string, unknown>) => Promise<unknown>
> = {
  "view:dashboard": async () => resolveDashboardView(),
  "view:tasks": async () => resolveTasksView(),
  "view:calendar": async (args) =>
    resolveCalendarView(args as Partial<CalendarViewArgs> | undefined),
  "view:roadmap": async () => resolveRoadmapView(),
  "view:planning": async () => resolvePlanningView(),
  "view:settings": async () => resolveSettingsView(),
  "view:news-feed": async () => resolveNewsFeedView(),
  "view:onboarding": async () => resolveOnboardingView(),
  "view:goal-plan": async (args) => {
    const goalId = (args as { goalId?: string } | undefined)?.goalId;
    if (!goalId) throw new Error("view:goal-plan requires args.goalId");
    return resolveGoalPlanView({ goalId });
  },
  "view:goal-breakdown": async (args) =>
    resolveGoalBreakdownView(args as GoalBreakdownViewArgs | undefined),
};
