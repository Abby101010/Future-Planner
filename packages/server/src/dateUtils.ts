/* NorthStar server — date utilities
 *
 * Central place for computing "today" with timezone adjustment.
 *
 * TIMEZONE: Use the client's IANA timezone (from the X-Timezone
 * header) instead of server UTC. The day boundary is midnight —
 * a new calendar day starts at 12:00 AM local time.
 *
 * Every view resolver and AI handler should call `getEffectiveDate()`
 * instead of `new Date().toISOString().split("T")[0]`.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** AsyncLocalStorage that the timezone middleware populates per-request. */
export const timezoneStore = new AsyncLocalStorage<string>();

/**
 * Get the user's effective "today" date as YYYY-MM-DD.
 *
 * Uses the request-scoped timezone from `timezoneStore` (set by the
 * middleware) or falls back to UTC. Day boundary is midnight.
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
  }).formatToParts(now);

  let year = 0;
  let month = 0;
  let day = 0;
  for (const p of parts) {
    if (p.type === "year") year = Number(p.value);
    else if (p.type === "month") month = Number(p.value);
    else if (p.type === "day") day = Number(p.value);
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

/**
 * Format an arbitrary Date/timestamp as YYYY-MM-DD in the user's timezone.
 *
 * Like `getEffectiveDate()` but for a given instant instead of `now()`.
 * Useful for comparing DB timestamps (stored in UTC) against the user's
 * local calendar date.
 */
export function formatDateInTz(date: Date | string): string {
  const tz = timezoneStore.getStore() || "UTC";
  const d = typeof date === "string" ? new Date(date) : date;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  let year = 0;
  let month = 0;
  let day = 0;
  for (const p of parts) {
    if (p.type === "year") year = Number(p.value);
    else if (p.type === "month") month = Number(p.value);
    else if (p.type === "day") day = Number(p.value);
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
