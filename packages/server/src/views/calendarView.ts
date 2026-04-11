/* NorthStar server — calendar view resolver
 *
 * Narrow per-page aggregate for CalendarPage. Takes a date range and
 * returns all calendar events in that range, plus the vacation mode
 * and goal list (used by the event form's "link to goal" dropdown).
 *
 * deviceIntegrations still lives on app_store for now since we don't
 * have a dedicated table — we fall back and mark it TODO(phase6).
 */

import * as repos from "../repositories";
import { query } from "../db/pool";
import { requireUserId } from "../repositories/_context";
import type { CalendarEvent, DeviceIntegrations, Goal } from "@northstar/core";

export interface CalendarVacationMode {
  active: boolean;
  startDate: string | null;
  endDate: string | null;
}

export interface CalendarViewArgs {
  startDate: string;
  endDate: string;
}

export interface CalendarView {
  rangeStart: string;
  rangeEnd: string;
  events: CalendarEvent[];
  goals: Goal[];
  deviceIntegrations: DeviceIntegrations | null;
  vacationMode: CalendarVacationMode;
}

function defaultRange(): CalendarViewArgs {
  // One month centered on today — safe default for CalendarPage's
  // monthly grid if the client forgets to send args.
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  return {
    startDate: start.toISOString().split("T")[0],
    endDate: end.toISOString().split("T")[0],
  };
}

async function readAppStoreKey<T>(key: string): Promise<T | null> {
  const userId = requireUserId();
  const rows = await query<{ value: T }>(
    `select value from app_store where user_id = $1 and key = $2`,
    [userId, key],
  );
  return rows.length > 0 ? (rows[0].value as T) : null;
}

export async function resolveCalendarView(
  args?: Partial<CalendarViewArgs>,
): Promise<CalendarView> {
  const defaults = defaultRange();
  const startDate = args?.startDate || defaults.startDate;
  const endDate = args?.endDate || defaults.endDate;

  const [events, goals, vacationState] = await Promise.all([
    repos.calendar.listForRange(startDate, endDate),
    repos.goals.list(),
    repos.vacationMode.get(),
  ]);

  // TODO(phase6): move deviceIntegrations to a dedicated table.
  const deviceIntegrations =
    await readAppStoreKey<DeviceIntegrations>("deviceIntegrations");

  const vacationMode: CalendarVacationMode = vacationState
    ? {
        active: vacationState.active,
        startDate: vacationState.startDate,
        endDate: vacationState.endDate,
      }
    : { active: false, startDate: null, endDate: null };

  return {
    rangeStart: startDate,
    rangeEnd: endDate,
    events,
    goals,
    deviceIntegrations,
    vacationMode,
  };
}
