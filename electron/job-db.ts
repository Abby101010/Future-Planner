/* ──────────────────────────────────────────────────────────
   NorthStar — Job Queue Database Layer

   SQLite-backed persistent job queue for background AI
   processing. Jobs survive app restarts and focus loss.
   ────────────────────────────────────────────────────────── */

import { randomUUID } from "node:crypto";
import { getDB } from "./database";
import type { JobRow, JobStatus, AgentProgressEvent } from "./agents/types";

// ── Insert ─────────────────────────────────────────────

export function insertJob(
  type: string,
  payload: Record<string, unknown>,
  maxRetries = 2
): string {
  const id = randomUUID();
  const db = getDB();
  db.prepare(
    `INSERT INTO job_queue (id, type, status, payload, max_retries)
     VALUES (?, ?, 'pending', ?, ?)`
  ).run(id, type, JSON.stringify(payload), maxRetries);
  return id;
}

// ── Read ───────────────────────────────────────────────

export function getJob(id: string): JobRow | null {
  const db = getDB();
  const row = db.prepare("SELECT * FROM job_queue WHERE id = ?").get(id) as JobRow | undefined;
  return row ?? null;
}

export function listJobs(filters?: {
  type?: string;
  status?: JobStatus;
  limit?: number;
}): JobRow[] {
  const db = getDB();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.type) {
    conditions.push("type = ?");
    params.push(filters.type);
  }
  if (filters?.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filters?.limit ?? 50;

  return db.prepare(
    `SELECT * FROM job_queue ${where} ORDER BY created_at DESC LIMIT ?`
  ).all(...params, limit) as JobRow[];
}

/** Get the next pending job (oldest first) */
export function getNextPendingJob(): JobRow | null {
  const db = getDB();
  const row = db.prepare(
    "SELECT * FROM job_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"
  ).get() as JobRow | undefined;
  return row ?? null;
}

// ── Update ─────────────────────────────────────────────

export function updateJobStatus(
  id: string,
  status: JobStatus,
  extra?: { result?: unknown; error?: string }
): void {
  const db = getDB();
  const now = new Date().toISOString();

  if (status === "running") {
    db.prepare(
      "UPDATE job_queue SET status = ?, started_at = ? WHERE id = ?"
    ).run(status, now, id);
  } else if (status === "completed") {
    db.prepare(
      "UPDATE job_queue SET status = ?, completed_at = ?, result = ? WHERE id = ?"
    ).run(status, now, extra?.result ? JSON.stringify(extra.result) : null, id);
  } else if (status === "failed") {
    db.prepare(
      "UPDATE job_queue SET status = ?, completed_at = ?, error = ?, retry_count = retry_count + 1 WHERE id = ?"
    ).run(status, now, extra?.error ?? null, id);
  } else {
    db.prepare(
      "UPDATE job_queue SET status = ? WHERE id = ?"
    ).run(status, id);
  }
}

export function updateJobProgress(
  id: string,
  progress: number,
  event?: AgentProgressEvent
): void {
  const db = getDB();

  if (event) {
    // Append event to progress_log
    const row = db.prepare("SELECT progress_log FROM job_queue WHERE id = ?").get(id) as { progress_log: string } | undefined;
    let log: AgentProgressEvent[] = [];
    try {
      log = JSON.parse(row?.progress_log || "[]");
    } catch { /* ignore */ }
    log.push(event);
    db.prepare(
      "UPDATE job_queue SET progress = ?, progress_log = ? WHERE id = ?"
    ).run(progress, JSON.stringify(log), id);
  } else {
    db.prepare(
      "UPDATE job_queue SET progress = ? WHERE id = ?"
    ).run(progress, id);
  }
}

// ── Cancel ─────────────────────────────────────────────

export function cancelJob(id: string): boolean {
  const db = getDB();
  const result = db.prepare(
    "UPDATE job_queue SET status = 'cancelled', completed_at = ? WHERE id = ? AND status IN ('pending', 'running')"
  ).run(new Date().toISOString(), id);
  return result.changes > 0;
}

// ── Re-queue failed job ────────────────────────────────

export function requeueJob(id: string): boolean {
  const db = getDB();
  const job = getJob(id);
  if (!job || job.status !== "failed") return false;
  if (job.retry_count >= job.max_retries) return false;

  db.prepare(
    "UPDATE job_queue SET status = 'pending', error = NULL, started_at = NULL, completed_at = NULL WHERE id = ?"
  ).run(id);
  return true;
}

// ── Cleanup ────────────────────────────────────────────

/** Remove completed/failed/cancelled jobs older than `days` */
export function cleanOldJobs(days = 7): number {
  const db = getDB();
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const result = db.prepare(
    "DELETE FROM job_queue WHERE status IN ('completed', 'failed', 'cancelled') AND created_at < ?"
  ).run(cutoff);
  return result.changes;
}
