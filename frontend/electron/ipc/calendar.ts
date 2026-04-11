/* NorthStar — device calendar IPC handlers (device:* only)
 *
 * Phase 13 killed calendar:* CRUD — those now live on the backend.
 * This file now only exposes macOS Calendar.app access, which has no
 * cloud equivalent.
 */

import { ipcMain } from "electron";
import { listDeviceCalendars, getDeviceCalendarEvents } from "../calendar";

export function registerCalendarIpc(): void {
  ipcMain.handle("device:list-calendars", async () => {
    try {
      const calendars = await listDeviceCalendars();
      return { ok: true, calendars };
    } catch (err) {
      return { ok: false, error: String(err), calendars: [] };
    }
  });

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
}
