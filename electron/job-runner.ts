/* ──────────────────────────────────────────────────────────
   NorthStar — Background Job Runner

   Runs in the Electron main process. Polls the SQLite
   job_queue for pending jobs and processes them sequentially
   via the coordinator. Completely independent of the
   renderer — survives focus loss, window close, etc.
   ────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import { BrowserWindow } from "electron";
import {
  getNextPendingJob,
  updateJobStatus,
  updateJobProgress,
  requeueJob,
  cleanOldJobs,
} from "./job-db";
import { handleAIRequest } from "./ai-handler";
import type { AgentProgressEvent, CoordinatorTaskType } from "./agents/types";

export class JobRunner {
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private processing = false;
  private loadData: () => Record<string, unknown>;
  private getMainWindow: () => BrowserWindow | null;

  constructor(
    loadData: () => Record<string, unknown>,
    getMainWindow: () => BrowserWindow | null
  ) {
    this.loadData = loadData;
    this.getMainWindow = getMainWindow;
  }

  /** Start polling for pending jobs */
  start(intervalMs = 500): void {
    if (this.running) return;
    this.running = true;

    // Clean old jobs on startup
    try { cleanOldJobs(7); } catch { /* non-critical */ }

    this.timer = setInterval(() => this.tick(), intervalMs);
    console.log("[JobRunner] Started polling");
  }

  /** Stop polling */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log("[JobRunner] Stopped");
  }

  /** Single poll tick — check for pending jobs and process one */
  private async tick(): Promise<void> {
    if (this.processing) return; // already working on a job

    const job = getNextPendingJob();
    if (!job) return;

    this.processing = true;

    try {
      // Mark as running
      updateJobStatus(job.id, "running");
      this.notifyRenderer(job.id);

      // Build a progress callback that writes to SQLite
      const onProgress = (event: AgentProgressEvent) => {
        const progress = event.progress ?? 0;
        updateJobProgress(job.id, progress, event);
        this.notifyRenderer(job.id);
      };

      // Parse the payload
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(job.payload);
      } catch {
        throw new Error("Invalid job payload JSON");
      }

      // Execute through the existing handleAIRequest pipeline
      // which routes through the coordinator
      const result = await handleAIRequest(
        job.type as CoordinatorTaskType,
        payload,
        this.loadData,
        onProgress
      );

      // Mark completed
      updateJobStatus(job.id, "completed", { result });
      updateJobProgress(job.id, 100);
      this.notifyRenderer(job.id);

      console.log(`[JobRunner] Job ${job.id} (${job.type}) completed`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[JobRunner] Job ${job.id} (${job.type}) failed:`, errorMsg);

      updateJobStatus(job.id, "failed", { error: errorMsg });
      this.notifyRenderer(job.id);

      // Auto-retry if under max retries
      const requeued = requeueJob(job.id);
      if (requeued) {
        console.log(`[JobRunner] Job ${job.id} re-queued for retry`);
      }
    } finally {
      this.processing = false;
    }
  }

  /** Best-effort push notification to renderer */
  private notifyRenderer(jobId: string): void {
    try {
      const win = this.getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send("job:updated", jobId);
      }
    } catch {
      // Fire-and-forget — renderer may not be available
    }
  }
}
