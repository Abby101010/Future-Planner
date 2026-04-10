/* NorthStar — job queue IPC handlers */

import { ipcMain } from "electron";
import { insertJob, getJob, listJobs, cancelJob } from "../job-db";
import type { JobStatus } from "../agents/types";

export function registerJobIpc(): void {
  ipcMain.handle(
    "job:submit",
    async (
      _event,
      payload: {
        type: string;
        payload: Record<string, unknown>;
        maxRetries?: number;
      },
    ) => {
      try {
        const jobId = insertJob(
          payload.type,
          payload.payload,
          payload.maxRetries,
        );
        return { ok: true, jobId };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    "job:status",
    async (_event, payload: { jobId: string }) => {
      try {
        const job = getJob(payload.jobId);
        if (!job) return { ok: false, error: "Job not found" };
        return {
          ok: true,
          job: {
            id: job.id,
            type: job.type,
            status: job.status,
            progress: job.progress,
            progress_log: JSON.parse(job.progress_log || "[]"),
            result: job.result ? JSON.parse(job.result) : null,
            error: job.error,
            created_at: job.created_at,
            started_at: job.started_at,
            completed_at: job.completed_at,
          },
        };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    "job:list",
    async (
      _event,
      payload?: { type?: string; status?: JobStatus; limit?: number },
    ) => {
      try {
        const jobs = listJobs(payload);
        return {
          ok: true,
          jobs: jobs.map((j) => ({
            id: j.id,
            type: j.type,
            status: j.status,
            progress: j.progress,
            created_at: j.created_at,
            completed_at: j.completed_at,
          })),
        };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  ipcMain.handle(
    "job:cancel",
    async (_event, payload: { jobId: string }) => {
      try {
        const cancelled = cancelJob(payload.jobId);
        return { ok: true, cancelled };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );
}
