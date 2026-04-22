/* NorthStar server — BullMQ job handlers (Phase 3 scaffolding)
 *
 * Register job types here with registerJobHandler(). Phase 3 intentionally
 * ships with only a "noop" handler so the queue is exercisable end-to-end
 * in staging without migrating any existing command. Phase 4 will add
 * "nightly-reflection" + "morning-nudges" alongside.
 *
 * IMPORTANT: Do NOT migrate existing blocking commands (regenerate-goal-plan
 * et al.) off job-db.ts here — that is an explicit out-of-scope item for
 * the additive upgrade sequence.
 */

import { registerJobHandler } from "./queue";

export function registerAllJobHandlers(): void {
  registerJobHandler<{ message?: string }, { echoed: string; at: string }>(
    "noop",
    async (job) => {
      const msg = job.data.message ?? "ping";
      console.log(`[bull] noop handler ran with: ${msg}`);
      return { echoed: msg, at: new Date().toISOString() };
    },
  );
}
