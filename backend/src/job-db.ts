/* Starward server — Postgres-backed job queue
 *
 * Lightweight async job system for long-running commands (goal plan
 * generation, adaptive rescheduling). Uses the existing `job_queue`
 * table from migration 0001.
 *
 * Flow:
 *   1. Command handler calls insertJob() → returns jobId immediately
 *   2. Job worker (startJobWorker) polls for pending jobs
 *   3. Worker runs the job handler in a request context
 *   4. On completion: updates DB, pushes WS event to client
 */

import { randomUUID } from "node:crypto";
import { query } from "./db/pool";

export interface InsertJobArgs {
  type: string;
  payload: Record<string, unknown>;
  maxRetries?: number;
}

export interface JobRow {
  id: string;
  user_id: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
}

/**
 * Insert a new job into the queue. Returns the job ID.
 */
export async function insertJob(
  userId: string,
  type: string,
  payload: Record<string, unknown>,
  maxRetries = 2,
): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO job_queue (id, user_id, type, status, payload, max_retries)
     VALUES ($1, $2, $3, 'pending', $4, $5)`,
    [id, userId, type, JSON.stringify(payload), maxRetries],
  );
  return id;
}

/**
 * Claim the next pending job (atomic — only one worker gets it).
 */
export async function claimNextJob(): Promise<JobRow | null> {
  const rows = await query<JobRow>(
    `UPDATE job_queue
     SET status = 'running', started_at = now()
     WHERE (user_id, id) = (
       SELECT user_id, id FROM job_queue
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, user_id, type, status, payload, result, error, created_at::text`,
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Mark a job as completed with its result.
 */
export async function completeJob(
  userId: string,
  jobId: string,
  result: Record<string, unknown>,
): Promise<void> {
  await query(
    `UPDATE job_queue
     SET status = 'completed', result = $3, completed_at = now()
     WHERE user_id = $1 AND id = $2`,
    [userId, jobId, JSON.stringify(result)],
  );
}

/**
 * Mark a job as failed. Retries if under the max.
 */
export async function failJob(
  userId: string,
  jobId: string,
  error: string,
): Promise<void> {
  await query(
    `UPDATE job_queue
     SET status = CASE
       WHEN retry_count + 1 < max_retries THEN 'pending'
       ELSE 'failed'
     END,
     error = $3,
     retry_count = retry_count + 1,
     completed_at = CASE
       WHEN retry_count + 1 >= max_retries THEN now()
       ELSE NULL
     END
     WHERE user_id = $1 AND id = $2`,
    [userId, jobId, error],
  );
}

/**
 * Get a job by ID (for status polling).
 */
export async function getJob(
  userId: string,
  jobId: string,
): Promise<JobRow | null> {
  const rows = await query<JobRow>(
    `SELECT id, user_id, type, status, payload, result, error, created_at::text
     FROM job_queue
     WHERE user_id = $1 AND id = $2`,
    [userId, jobId],
  );
  return rows.length > 0 ? rows[0] : null;
}

/** Descriptor for an in-flight plan-generation job, surfaced on view
 *  payloads so the FE can render a "Planning…" state without a separate
 *  poll of /commands/job-status/:id. */
export interface PlanJobDescriptor {
  jobId: string;
  /** 'pending' = queued; 'running' = worker picked it up. */
  status: "pending" | "running";
  /** ISO8601 timestamp of job creation; used by the FE to render an
   *  elapsed-time counter. */
  startedAt: string;
}

interface PlanJobRow {
  id: string;
  status: string;
  created_at: string;
  goal_id: string | null;
}

/** Return the most recent pending/running plan-generation job for a goal,
 *  or null. Used by `view:goal-plan` to surface an `inFlight` field when
 *  a `regenerate-goal-plan` job is queued or executing. */
export async function findActivePlanJob(
  userId: string,
  goalId: string,
): Promise<PlanJobDescriptor | null> {
  const rows = await query<PlanJobRow>(
    `SELECT id, status, created_at::text, payload->>'goalId' AS goal_id
       FROM job_queue
      WHERE user_id = $1
        AND type = 'regenerate-goal-plan'
        AND status IN ('pending', 'running')
        AND payload->>'goalId' = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId, goalId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    jobId: r.id,
    status: r.status === "running" ? "running" : "pending",
    startedAt: r.created_at,
  };
}

/** Return a map of goalId → active plan-job descriptor for every goal
 *  that currently has a pending or running `regenerate-goal-plan` job.
 *  Used by `view:planning` to annotate goal cards with a "Planning…" pill
 *  in one indexed query rather than N per-goal round-trips. */
export async function findActivePlanJobsByUser(
  userId: string,
): Promise<Map<string, PlanJobDescriptor>> {
  const rows = await query<PlanJobRow>(
    `SELECT DISTINCT ON (payload->>'goalId')
            id, status, created_at::text, payload->>'goalId' AS goal_id
       FROM job_queue
      WHERE user_id = $1
        AND type = 'regenerate-goal-plan'
        AND status IN ('pending', 'running')
        AND payload->>'goalId' IS NOT NULL
      ORDER BY payload->>'goalId', created_at DESC`,
    [userId],
  );
  const out = new Map<string, PlanJobDescriptor>();
  for (const r of rows) {
    if (!r.goal_id) continue;
    out.set(r.goal_id, {
      jobId: r.id,
      status: r.status === "running" ? "running" : "pending",
      startedAt: r.created_at,
    });
  }
  return out;
}
