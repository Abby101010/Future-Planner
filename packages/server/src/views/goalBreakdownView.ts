/* NorthStar server — goal breakdown view resolver
 *
 * GoalBreakdownPage is an alternate rendering of the legacy
 * `GoalBreakdown` shape. Historically it lived inside `app_store` under
 * key "goalBreakdown". The modern source of truth for a goal's plan is
 * `goals` + `goal_plan_nodes` — GoalBreakdown is not backed by its own
 * table and will be deleted in a follow-up once GoalBreakdownPage is
 * rewritten to render directly from the goal plan tree.
 *
 * Until then, this resolver returns null for goalBreakdown and lets
 * the page either re-run the AI handler or degrade gracefully. It
 * still returns live events + device integrations for the reallocate
 * flow that the page hosts.
 */

import * as repos from "../repositories";
import type {
  CalendarEvent,
  DeviceIntegrations,
  GoalBreakdown,
} from "@northstar/core";

export interface GoalBreakdownViewArgs {
  goalId?: string;
}

export interface GoalBreakdownView {
  goalBreakdown: GoalBreakdown | null;
  calendarEvents: CalendarEvent[];
  deviceIntegrations: DeviceIntegrations | null;
}

export async function resolveGoalBreakdownView(
  _args?: GoalBreakdownViewArgs,
): Promise<GoalBreakdownView> {
  void _args;

  // Use a wide 90-day window — the reallocate flow inside the page
  // passes these events straight into the AI handler as the schedule
  // context.
  const today = new Date().toISOString().split("T")[0];
  const end = new Date();
  end.setDate(end.getDate() + 90);
  const endISO = end.toISOString().split("T")[0];

  const [calendarEvents, deviceIntegrations] = await Promise.all([
    repos.calendar.listForRange(today, endISO),
    repos.users.getDeviceIntegrations(),
  ]);

  return {
    goalBreakdown: null,
    calendarEvents,
    deviceIntegrations,
  };
}
