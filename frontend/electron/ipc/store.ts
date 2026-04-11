/* NorthStar — store IPC handlers (store:load, store:save) */

import { ipcMain } from "electron";
import { getIpcContext } from "./context";

export function registerStoreIpc(): void {
  const ctx = getIpcContext();

  ipcMain.handle("store:load", async () => {
    return ctx.loadData();
  });

  ipcMain.handle(
    "store:save",
    async (_event, data: Record<string, unknown>) => {
      await ctx.saveData(data);
      return { ok: true };
    },
  );
}
