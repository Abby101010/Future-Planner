/* dailyTriageDispatch — fire-and-forget wrapper around lightTriage.
 *
 * Mutators (cmdCreateTask, materializePlanTasks, rotateNextTask, chat
 * intents, etc.) call `fireLightTriage(date)` after their own DB write
 * succeeds. The triage runs on the next microtask boundary, preserving
 * the user/timezone request context via runWithUserId + timezoneStore.
 *
 * Failure-tolerant: errors log and swallow so the original mutation's
 * response is never affected. The user-perceived latency stays
 * unchanged; the reorder lands ~1-2s later via the WS view:invalidate
 * the triage emits internally.
 *
 * This file is intentionally separate from dailyTriage.ts so that
 * dailyTriage.ts (which imports priorityAnnotator + repos) can call
 * other services that themselves want to dispatch triage without
 * creating a circular import.
 */

import { getCurrentUserId } from "../middleware/requestContext";
import { runWithUserId } from "../middleware/requestContext";
import { timezoneStore } from "../dateUtils";

export function fireLightTriage(date: string): void {
  const userId = getCurrentUserId();
  const tz = timezoneStore.getStore() || "UTC";
  setImmediate(() => {
    runWithUserId(userId, () =>
      timezoneStore.run(tz, async () => {
        try {
          const { lightTriage } = await import("./dailyTriage");
          await lightTriage(date);
        } catch (err) {
          console.warn("[triage] light pass failed:", err);
        }
      }),
    );
  });
}
