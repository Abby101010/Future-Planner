/* dayRolloverDecision — pure helpers for the day-rollover refresh hook.
 *
 * Lives in its own file (no React, no wsClient, no env-dependent
 * imports) so the unit test can exercise the decision logic directly
 * under Vitest's node environment without dragging in the WS client or
 * Supabase initialization.
 */

/** YYYY-MM-DD in local time. */
export function localDateString(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export interface ShouldRefreshArgs {
  lastDate: string;
  lastActivity: number;
  currentDate: string;
  now: number;
  thresholdMs?: number;
}

/** Belt-and-suspenders threshold: refetch when idle longer than this
 *  even if the local date hasn't flipped. */
export const ACTIVITY_THRESHOLD_MS = 60_000;

/** Returns true when the day-rollover hook should fire a refetch. */
export function shouldRefresh(args: ShouldRefreshArgs): boolean {
  const threshold = args.thresholdMs ?? ACTIVITY_THRESHOLD_MS;
  if (args.currentDate !== args.lastDate) return true;
  if (args.now - args.lastActivity > threshold) return true;
  return false;
}
