/* NorthStar server — goal breakdown view resolver
 *
 * GoalBreakdownPage is currently an alternate rendering of a full
 * `GoalBreakdown` object that lives in the legacy app_store row under
 * key "goalBreakdown". The page also reads calendarEvents and
 * deviceIntegrations for the reallocate flow. We fall back to
 * app_store for the breakdown and integrations while returning live
 * events from calendarRepo.
 *
 * TODO(phase6): migrate GoalBreakdown out of app_store once the
 * per-entity tables subsume it, and delete this fallback.
 */

import * as repos from "../repositories";
import { query } from "../db/pool";
import { requireUserId } from "../repositories/_context";
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

async function readAppStoreKey<T>(key: string): Promise<T | null> {
  const userId = requireUserId();
  const rows = await query<{ value: T }>(
    `select value from app_store where user_id = $1 and key = $2`,
    [userId, key],
  );
  return rows.length > 0 ? (rows[0].value as T) : null;
}

export async function resolveGoalBreakdownView(
  _args?: GoalBreakdownViewArgs,
): Promise<GoalBreakdownView> {
  void _args;

  // TODO(phase6): derive from goals + goal_plan_nodes, not app_store.
  const [goalBreakdown, deviceIntegrations] = await Promise.all([
    readAppStoreKey<GoalBreakdown>("goalBreakdown"),
    readAppStoreKey<DeviceIntegrations>("deviceIntegrations"),
  ]);

  // Use a wide 90-day window — the reallocate flow inside the page
  // passes these events straight into the AI handler as the schedule
  // context.
  const today = new Date().toISOString().split("T")[0];
  const end = new Date();
  end.setDate(end.getDate() + 90);
  const endISO = end.toISOString().split("T")[0];
  const calendarEvents = await repos.calendar.listForRange(today, endISO);

  return {
    goalBreakdown,
    calendarEvents,
    deviceIntegrations,
  };
}
