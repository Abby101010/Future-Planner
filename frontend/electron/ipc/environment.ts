/* NorthStar — environment:get IPC handler */

import { ipcMain } from "electron";
import {
  getEnvironmentContext,
  formatEnvironmentContext,
} from "../environment";
import { getIpcContext } from "./context";

export function registerEnvironmentIpc(): void {
  const ctx = getIpcContext();

  ipcMain.handle("environment:get", async () => {
    try {
      const env = await getEnvironmentContext(ctx.getMainWindow());
      return { ok: true, data: env, formatted: formatEnvironmentContext(env) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
}
