/* Starward server — Background Job Worker
 *
 * Polls the job_queue table for pending jobs and processes them.
 * Each job type maps to a handler function. On completion, pushes
 * a WS event to the client so the UI can update.
 *
 * Job types:
 *   - regenerate-goal-plan: Opus goal plan generation
 *   - adaptive-reschedule: Opus plan rescheduling
 *   - adjust-all-overloaded-plans: batch N × adaptive-reschedule
 */

import { claimNextJob, completeJob, failJob } from "./job-db";
import { emitJobComplete, emitJobFailed, emitViewInvalidate } from "./ws/events";
import { runWithUserId } from "./middleware/requestContext";

// Lazy-import job handlers to avoid circular deps at module load time.

async function processJob(
  userId: string,
  jobId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // Run inside request context so handlers can call getCurrentUserId()
  return runWithUserId(userId, async () => {
    switch (type) {
      case "regenerate-goal-plan": {
        const { cmdRegenerateGoalPlan } = await import("./routes/commands/planning");
        const result = await cmdRegenerateGoalPlan(payload);
        return (result ?? { ok: true }) as Record<string, unknown>;
      }
      case "adaptive-reschedule": {
        const { cmdAdaptiveReschedule } = await import("./routes/commands/planning");
        const result = await cmdAdaptiveReschedule(payload);
        return (result ?? { ok: true }) as Record<string, unknown>;
      }
      case "adjust-all-overloaded-plans": {
        const { cmdAdjustAllOverloadedPlans } = await import("./routes/commands/planning");
        const result = await cmdAdjustAllOverloadedPlans(payload);
        return (result ?? { ok: true }) as Record<string, unknown>;
      }
      default:
        throw new Error(`Unknown job type: ${type}`);
    }
  });
}

let running = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

const POLL_INTERVAL_MS = 2000; // check every 2 seconds
const IDLE_INTERVAL_MS = 10000; // slow down when idle

/**
 * Poll for and process one pending job.
 * Returns true if a job was processed (so the next poll can be immediate).
 */
async function pollOnce(): Promise<boolean> {
  try {
    const job = await claimNextJob();
    if (!job) return false;

    console.log(`[job-worker] Processing job ${job.id} (${job.type})`);

    try {
      const result = await processJob(
        job.user_id,
        job.id,
        job.type,
        job.payload,
      );

      await completeJob(job.user_id, job.id, result);

      // Push completion to client
      emitJobComplete(job.user_id, {
        jobId: job.id,
        type: job.type,
        result,
      });

      // Invalidate relevant views so the UI refreshes
      const viewsToInvalidate = getViewsForJobType(job.type);
      if (viewsToInvalidate.length > 0) {
        emitViewInvalidate(job.user_id, { viewKinds: viewsToInvalidate });
      }

      console.log(`[job-worker] Job ${job.id} completed`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[job-worker] Job ${job.id} failed:`, message);

      await failJob(job.user_id, job.id, message);

      emitJobFailed(job.user_id, {
        jobId: job.id,
        type: job.type,
        error: message,
      });
    }

    return true;
  } catch (err) {
    console.error("[job-worker] Poll error:", err);
    return false;
  }
}

function getViewsForJobType(type: string): Array<import("@starward/core").QueryKind> {
  switch (type) {
    case "regenerate-goal-plan":
      // Materializes daily_tasks via goalPlanRepo.replacePlan (see
      // cmdRegenerateGoalPlan: it flips planConfirmed=true before replacePlan
      // so the helper auto-creates rows in daily_tasks). Tasks page +
      // Calendar must invalidate for the user to see them; missing these
      // was the bug behind "I generated a plan but no tasks showed up
      // in Today". view:goal-breakdown was added after a chat-driven
      // replan saved a new plan but the BreakdownTab kept showing stale
      // data because nothing told the FE to refetch. Must stay in sync
      // with views/_invalidation.ts.
      return [
        "view:goal-plan",
        "view:goal-breakdown",
        "view:planning",
        "view:dashboard",
        "view:tasks",
        "view:calendar",
      ];
    case "adaptive-reschedule":
      return [
        "view:goal-plan",
        "view:goal-breakdown",
        "view:planning",
        "view:tasks",
        "view:dashboard",
        "view:calendar",
      ];
    case "adjust-all-overloaded-plans":
      return [
        "view:goal-plan",
        "view:goal-breakdown",
        "view:planning",
        "view:tasks",
        "view:dashboard",
        "view:calendar",
      ];
    default:
      return [];
  }
}

function schedulePoll(intervalMs: number): void {
  if (!running) return;
  pollTimer = setTimeout(async () => {
    const hadWork = await pollOnce();
    // If we just processed a job, check again immediately (more might be queued).
    // Otherwise, use the idle interval.
    schedulePoll(hadWork ? POLL_INTERVAL_MS : IDLE_INTERVAL_MS);
  }, intervalMs);
}

/**
 * Start the background job worker. Call once at server startup.
 */
export function startJobWorker(): void {
  if (running) return;
  running = true;
  console.log("[job-worker] Started");
  schedulePoll(POLL_INTERVAL_MS);
}

/**
 * Stop the job worker (for graceful shutdown).
 */
export function stopJobWorker(): void {
  running = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  console.log("[job-worker] Stopped");
}
