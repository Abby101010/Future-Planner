/* NorthStar server — job queue stub
 *
 * Phase 1: background jobs still run inside the Electron shell against
 * the local SQLite job_queue table. The server's home-chat handler calls
 * insertJob() to kick off big-goal plan generation in the background —
 * on the server we skip the background path and the goal gets generated
 * synchronously by the handler that returns it.
 *
 * Phase 1b: stand up a real cloud job queue (BullMQ + Redis, or Fly's
 * scheduled machines, or just Postgres-backed polling from a worker
 * container) and re-enable the insertJob path.
 *
 * Note: this stub returns a synthetic job id so the handler's logging /
 * downstream code paths don't break — the id never actually refers to a
 * queued job.
 */

import { randomUUID } from "node:crypto";

export interface InsertJobArgs {
  type: string;
  payload: Record<string, unknown>;
  maxRetries?: number;
}

export function insertJob(
  _type: string,
  _payload: Record<string, unknown>,
  _maxRetries?: number,
): string {
  // Synthetic id. Not persisted. Phase 1 home-chat runs the eager path
  // synchronously for big-goal plans instead of deferring.
  return randomUUID();
}
