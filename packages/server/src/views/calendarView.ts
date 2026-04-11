/* NorthStar server — calendar view resolver
 *
 * Narrow per-page aggregate for CalendarPage. Takes a date range and
 * returns all calendar events in that range, plus the vacation mode,
 * the goal list (used by the event form's "link to goal" dropdown),
 * and the user's device integrations (for OS calendar sync state).
 */

import * as repos from "../repositories";
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

export async function resolveCalendarView(
  args?: Partial<CalendarViewArgs>,
): Promise<CalendarView> {
  const defaults = defaultRange();
  const startDate = args?.startDate || defaults.startDate;
  const endDate = args?.endDate || defaults.endDate;

  const [events, goals, vacationState, deviceIntegrations] = await Promise.all([
    repos.calendar.listForRange(startDate, endDate),
    repos.goals.list(),
    repos.vacationMode.get(),
    repos.users.getDeviceIntegrations(),
  ]);

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
