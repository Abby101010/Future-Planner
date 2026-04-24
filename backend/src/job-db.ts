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
