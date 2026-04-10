/* NorthStar — calendar IPC handlers (calendar:* + device:*) */

import { ipcMain } from "electron";
import {
  getScheduleContext,
  summarizeScheduleForAI,
  listDeviceCalendars,
  getDeviceCalendarEvents,
} from "../calendar";
import {
  getAllCalendarEvents,
  getCalendarEventsByRange,
  upsertCalendarEvent,
  deleteCalendarEvent,
} from "../database";
import { getIpcContext } from "./context";

export function registerCalendarIpc(): void {
  const ctx = getIpcContext();

  // Build schedule from DB events + optional device data
  ipcMain.handle("calendar:schedule", async (_event, payload) => {
    try {
      const startDate = payload.startDate as string;
      const endDate = payload.endDate as string;
      const deviceIntegrations = payload.deviceIntegrations || undefined;

      let inAppEvents = payload.inAppEvents || [];
      if (ctx.isDbAvailable()) {
        try {
          const dbEvents = await getCalendarEventsByRange(startDate, endDate);
          inAppEvents = dbEvents.map(
            (e: {
              id: string;
              title: string;
              start_date: string;
              end_date: string;
              is_all_day: boolean | number;
              duration_minutes: number;
              is_vacation: boolean | number;
              source: string;
            }) => ({
              id: e.id,
              title: e.title,
              startDate: e.start_date,
              endDate: e.end_date,
              isAllDay: e.is_all_day,
              durationMinutes: e.duration_minutes,
              isVacation: e.is_vacation,
              source: e.source,
            }),
          );
        } catch (err) {
          console.warn(
            "[DB] Calendar events read failed, using payload:",
            err,
          );
        }
      }

      const scheduleCtx = await getScheduleContext(
        startDate,
        endDate,
        inAppEvents,
        deviceIntegrations,
      );
      return {
        ok: true,
        data: scheduleCtx,
        summary: summarizeScheduleForAI(scheduleCtx),
      };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // List available device calendars
  ipcMain.handle("device:list-calendars", async () => {
    try {
      const calendars = await listDeviceCalendars();
      return { ok: true, calendars };
    } catch (err) {
      return { ok: false, error: String(err), calendars: [] };
    }
  });

  // Import events from device calendar
  ipcMain.handle("device:import-calendar-events", async (_event, payload) => {
    try {
      const startDate = payload.startDate as string;
      const endDate = payload.endDate as string;
      const selectedCalendars = (payload.selectedCalendars || []) as string[];
      const events = await getDeviceCalendarEvents(
        startDate,
        endDate,
        selectedCalendars,
      );
      return { ok: true, events };
    } catch (err) {
      return { ok: false, error: String(err), events: [] };
    }
  });

  // ── Calendar CRUD ────────────────────────────────────────

  ipcMain.handle("calendar:list-events", async (_event, payload) => {
    try {
      if (!ctx.isDbAvailable())
        return { ok: false, error: "Database not available", events: [] };
      const events =
        payload?.startDate && payload?.endDate
          ? await getCalendarEventsByRange(payload.startDate, payload.endDate)
          : await getAllCalendarEvents();
      return { ok: true, events };
    } catch (err) {
      return { ok: false, error: String(err), events: [] };
    }
  });

  ipcMain.handle("calendar:upsert-event", async (_event, payload) => {
    try {
      if (!ctx.isDbAvailable())
        return { ok: false, error: "Database not available" };
      await upsertCalendarEvent(payload);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("calendar:delete-event", async (_event, payload) => {
    try {
      if (!ctx.isDbAvailable())
        return { ok: false, error: "Database not available" };
      await deleteCalendarEvent(payload.id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
}
