/* NorthStar — reminder IPC handlers */

import { ipcMain } from "electron";
import {
  getAllReminders,
  getRemindersByDate,
  upsertReminder,
  acknowledgeReminder,
  deleteReminder,
} from "../database";

export function registerReminderIpc(): void {
  ipcMain.handle("reminder:list", async (_event, payload) => {
    try {
      const data = payload?.date
        ? await getRemindersByDate(payload.date)
        : await getAllReminders();
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("reminder:upsert", async (_event, payload) => {
    try {
      await upsertReminder(payload);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("reminder:acknowledge", async (_event, payload) => {
    try {
      await acknowledgeReminder(payload.id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("reminder:delete", async (_event, payload) => {
    try {
      await deleteReminder(payload.id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
}
