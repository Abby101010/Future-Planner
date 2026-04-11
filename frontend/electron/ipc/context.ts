/* ──────────────────────────────────────────────────────────
   NorthStar — Shared IPC context

   main.ts owns the globals (mainWindow, _dbAvailable,
   loadData/saveData). Before calling setupIPC(), it initializes
   this context so the per-domain IPC registrars can read/write
   the shared state without re-deriving it.

   The job runner used to live here too — it was deleted in
   slice 6 along with the local SQLite job queue. AI calls now
   go straight to the cloud backend via cloudInvoke, so there
   is no in-process queue to expose.
   ────────────────────────────────────────────────────────── */

import type { BrowserWindow } from "electron";

export interface IpcContext {
  getMainWindow(): BrowserWindow | null;
  setMainWindow(w: BrowserWindow | null): void;
  isDbAvailable(): boolean;
  setDbAvailable(v: boolean): void;
  loadData(): Promise<Record<string, unknown>>;
  saveData(data: Record<string, unknown>): Promise<void>;
  loadDataSync(): Record<string, unknown>;
}

let _ctx: IpcContext | null = null;

export function initIpcContext(ctx: IpcContext): void {
  _ctx = ctx;
}

export function getIpcContext(): IpcContext {
  if (!_ctx) throw new Error("IPC context not initialized");
  return _ctx;
}
