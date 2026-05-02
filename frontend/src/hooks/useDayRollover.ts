/* useDayRollover — refetch date-sensitive views when the local date
 * changes or the app returns to focus after a long idle.
 *
 * The bug this fixes: every morning the user reopens the app and has
 * to manually refresh to see today's tasks. Three independent gaps
 * stacked up — most importantly, the frontend had no listener for
 * window focus / tab visibility / network reconnect, so the cached
 * view kept serving yesterday's `todayDate` indefinitely.
 *
 * What this hook does on `visibilitychange → visible`, `focus`, or
 * `online`:
 *
 *   1. Computes the current local date (YYYY-MM-DD).
 *   2. Compares against the date last seen.
 *   3. If different — OR more than 60s have passed since last activity —
 *      synthesizes a `view:invalidate` for the date-sensitive views.
 *      The existing useQuery `view:invalidate` listener handles the
 *      refetch via the same code path used for server-pushed
 *      invalidations.
 *
 * Mounted once in App.tsx. The pure helper `shouldRefresh` is
 * extracted for unit testing.
 */

import { useEffect, useRef } from "react";
import type { QueryKind } from "@starward/core";
import { wsClient } from "../services/wsClient";
import { localDateString, shouldRefresh } from "./dayRolloverDecision";

// Re-export so existing callers can keep importing from this hook file.
export { localDateString, shouldRefresh } from "./dayRolloverDecision";

/** Views whose contents depend on the user's notion of "today". */
const DATE_SENSITIVE_VIEWS: QueryKind[] = [
  "view:dashboard",
  "view:tasks",
  "view:calendar",
  "view:goal-plan",
  "view:goal-breakdown",
  "view:goal-dashboard",
];

export function useDayRollover(): void {
  // Refs survive re-renders and never trigger them. Initialized to "now"
  // so the very first focus event after mount doesn't always fire a
  // gratuitous refetch — the user just navigated here, no need.
  const lastDateRef = useRef<string>(localDateString());
  const lastActivityRef = useRef<number>(Date.now());

  useEffect(() => {
    const refresh = (): void => {
      const currentDate = localDateString();
      const now = Date.now();
      const fire = shouldRefresh({
        lastDate: lastDateRef.current,
        lastActivity: lastActivityRef.current,
        currentDate,
        now,
      });
      if (fire) {
        wsClient.emitLocal("view:invalidate", {
          viewKinds: DATE_SENSITIVE_VIEWS,
        });
      }
      lastDateRef.current = currentDate;
      lastActivityRef.current = now;
    };

    const onVisibility = (): void => {
      if (document.visibilityState === "visible") refresh();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);

    return (): void => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, []);
}
