/* NorthStar server — date utilities
 *
 * Central place for computing "today" with two adjustments:
 *
 * 1. TIMEZONE: Use the client's IANA timezone (from the X-Timezone
 *    header) instead of server UTC.
 *
 * 2. DAY BOUNDARY AT 6 AM: The "effective day" doesn't roll over at
 *    midnight — it rolls over at 6 AM local time. So at 2 AM on
 *    April 12 the user still sees April 11's tasks. This matches
 *    the reality that most people's day doesn't end at midnight.
 *
 * Every view resolver and AI handler should call `getEffectiveDate()`
 * instead of `new Date().toISOString().split("T")[0]`.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** Day-boundary hour (0-23). Before this hour, we treat it as "yesterday". */
const DAY_BOUNDARY_HOUR = 6;

/** AsyncLocalStorage that the timezone middleware populates per-request. */
export const timezoneStore = new AsyncLocalStorage<string>();

/**
 * Get the user's effective "today" date as YYYY-MM-DD.
 *
 * Uses the request-scoped timezone from `timezoneStore` (set by the
 * middleware) or falls back to UTC.
 *
 * Before 6 AM local time the effective date is yesterday.
 */
export function getEffectiveDate(): string {
  const tz = timezoneStore.getStore() || "UTC";

  // Format the current instant in the user's timezone
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);

  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  for (const p of parts) {
    if (p.type === "year") year = Number(p.value);
    else if (p.type === "month") month = Number(p.value);
    else if (p.type === "day") day = Number(p.value);
    else if (p.type === "hour") hour = Number(p.value);
  }

  // Before 6 AM → treat as previous day
  if (hour < DAY_BOUNDARY_HOUR) {
    const d = new Date(year, month - 1, day);
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Compute N days before the effective today.
 */
export function getEffectiveDaysAgo(days: number): string {
  const today = getEffectiveDate();
  const d = new Date(today + "T12:00:00Z");
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

/**
 * Get the current month key (YYYY-MM) based on effective date.
 */
export function getEffectiveMonthKey(): string {
  const today = getEffectiveDate();
  return today.slice(0, 7);
}
