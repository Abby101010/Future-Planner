/* Starward server — BullMQ-backed async queue (additive to job-db.ts)
 *
 * Phase 3: New Redis/BullMQ queue that lives ALONGSIDE the existing
 * Postgres-backed job-db.ts / job-worker.ts. Nothing is migrated off
 * job-db in this phase — this module exists so future phases (nightly
 * reflection scheduling, long-tail AI tasks, tool-use agent tasks) can
 * opt in without stressing the Postgres pool.
 *
 * Graceful degradation: if REDIS_URL is not set the queue becomes a
 * no-op. enqueue() returns a synthetic id and logs a warning; the
 * caller's primary flow is never affected. This lets local dev + Fly
 * deployments without the Redis secret continue to boot.
 */

import { Queue, Worker, type Job, type JobsOptions, QueueEvents } from "bullmq";
import type { Redis as IORedis } from "ioredis";
import IORedisCtor from "ioredis";

export type BullJobHandler<T = unknown, R = unknown> = (
  job: Job<T, R>,
) => Promise<R>;

const QUEUE_NAME = "starward-bg";
const BULL_JOB_HANDLERS = new Map<string, BullJobHandler>();

let connection: IORedis | null = null;
let queue: Queue | null = null;
let worker: Worker | null = null;
let events: QueueEvents | null = null;
let attempted = false;

function getRedisConnection(): IORedis | null {
  if (attempted) return connection;
  attempted = true;
  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn("[bull] REDIS_URL not set — async queue disabled");
    return null;
  }
  try {
    connection = new IORedisCtor(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    connection.on("error", (err: Error) => {
      console.error("[bull] redis connection error:", err.message);
    });
    return connection;
  } catch (err) {
    console.error("[bull] failed to init redis, queue disabled:", err);
    return null;
  }
}

function getQueue(): Queue | null {
  if (queue) return queue;
  const redis = getRedisConnection();
  if (!redis) return null;
  queue = new Queue(QUEUE_NAME, { connection: redis });
  return queue;
}

export function registerJobHandler<T = unknown, R = unknown>(
  type: string,
  handler: BullJobHandler<T, R>,
): void {
  BULL_JOB_HANDLERS.set(type, handler as BullJobHandler);
}

export interface EnqueueOptions {
  /** Seconds from now to delay processing. */
  delaySeconds?: number;
  /** Max retry attempts on failure (default 2). */
  attempts?: number;
  /** Idempotency key — BullMQ skips duplicate jobs with same jobId. */
  jobId?: string;
}

/**
 * Enqueue a background job. Returns the job id, or a synthetic `noop:<uuid>`
 * when Redis is not configured. Never throws.
 */
export async function enqueueJob<T>(
  type: string,
  data: T,
  opts: EnqueueOptions = {},
): Promise<string> {
  const q = getQueue();
  if (!q) {
    const id = `noop:${Math.random().toString(36).slice(2)}`;
    console.warn(`[bull] enqueue ${type} skipped (no redis) → ${id}`);
    return id;
  }
  try {
    const jobOpts: JobsOptions = {
      attempts: opts.attempts ?? 2,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: { age: 3600, count: 1000 },
      removeOnFail: { age: 24 * 3600 },
    };
    if (opts.delaySeconds) jobOpts.delay = opts.delaySeconds * 1000;
    if (opts.jobId) jobOpts.jobId = opts.jobId;
    const j = await q.add(type, data, jobOpts);
    return j.id ?? `nojobid:${Date.now()}`;
  } catch (err) {
    console.error(`[bull] enqueue ${type} failed:`, err);
    return `error:${Date.now()}`;
  }
}

/**
 * Start the worker process if REDIS_URL is set. Safe to call multiple
 * times — subsequent calls are no-ops. Registered job handlers must be
 * added BEFORE calling startBullWorker so the worker can route types.
 */
export function startBullWorker(): void {
  if (worker) return;
  const redis = getRedisConnection();
  if (!redis) {
    console.warn("[bull] startBullWorker skipped — no redis");
    return;
  }
  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const handler = BULL_JOB_HANDLERS.get(job.name);
      if (!handler) {
        throw new Error(`[bull] no handler registered for type '${job.name}'`);
      }
      return handler(job);
    },
    { connection: redis, concurrency: 2 },
  );
  worker.on("completed", (job) => {
    console.log(`[bull] ✓ ${job.name} (${job.id})`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[bull] ✗ ${job?.name} (${job?.id}):`, err.message);
  });
  events = new QueueEvents(QUEUE_NAME, { connection: redis });
  events.on("stalled", ({ jobId }) => {
    console.warn(`[bull] stalled job ${jobId}`);
  });
  console.log("[bull] worker started");
}

/**
 * Graceful shutdown helper — not wired into existing shutdown path,
 * reserved for future use.
 */
export async function closeBullQueue(): Promise<void> {
  await worker?.close().catch(() => {});
  await events?.close().catch(() => {});
  await queue?.close().catch(() => {});
  await connection?.quit().catch(() => {});
  worker = null;
  events = null;
  queue = null;
  connection = null;
  attempted = false;
  BULL_JOB_HANDLERS.clear();
}

export function isQueueAvailable(): boolean {
  return Boolean(process.env.REDIS_URL);
}
