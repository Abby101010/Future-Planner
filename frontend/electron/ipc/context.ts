/* NorthStar — shared IPC context
 *
 * Phase 13 stripped this down to just the mainWindow accessor. All the
 * DB/loadData state that used to live here is gone — data is on the
 * backend now.
 */

import type { BrowserWindow } from "electron";

export interface IpcContext {
  getMainWindow(): BrowserWindow | null;
  setMainWindow(w: BrowserWindow | null): void;
}

let _ctx: IpcContext | null = null;

export function initIpcContext(ctx: IpcContext): void {
  _ctx = ctx;
}

export function getIpcContext(): IpcContext {
  if (!_ctx) throw new Error("IPC context not initialized");
  return _ctx;
}
