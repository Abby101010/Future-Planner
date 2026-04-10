/* ──────────────────────────────────────────────────────────
   NorthStar — Shared IPC context

   main.ts owns the globals (mainWindow, jobRunner, _dbAvailable,
   loadData/saveData). Before calling setupIPC(), it initializes
   this context so the per-domain IPC registrars can read/write
   the shared state without re-deriving it.
   ────────────────────────────────────────────────────────── */

import type { BrowserWindow } from "electron";
import type { JobRunner } from "../job-runner";

export interface IpcContext {
  getMainWindow(): BrowserWindow | null;
  setMainWindow(w: BrowserWindow | null): void;
  getJobRunner(): JobRunner | null;
  setJobRunner(r: JobRunner | null): void;
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
