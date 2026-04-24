/* Starward — Environment context collector
 *
 * Gathers the user's local time, timezone, and (optionally) GPS
 * coordinates. Cached for 10 minutes so we don't hammer the
 * Geolocation API on every AI request.
 *
 * The data is sent alongside AI payloads to the server, which
 * enriches it with weather data (via Open-Meteo, no API key needed)
 * and formats the `_environmentContextFormatted` block.
 */

import { createLogger } from "../utils/logger";

const log = createLogger("environment");

export interface EnvironmentSnapshot {
  /** ISO 8601 local time string */
  localTime: string;
  /** IANA timezone, e.g. "America/New_York" */
  timezone: string;
  /** UTC offset string, e.g. "UTC-5" */
  utcOffset: string;
  /** Time of day bucket */
  timeOfDay: "morning" | "afternoon" | "evening" | "night";
  /** GPS latitude (null if denied or unavailable) */
  latitude: number | null;
  /** GPS longitude (null if denied or unavailable) */
  longitude: number | null;
}

let cachedSnapshot: EnvironmentSnapshot | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Resolve GPS position with a timeout. Returns null on failure. */
function getPosition(timeoutMs = 5000): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: CACHE_TTL_MS },
    );
  });
}

function getTimeOfDay(hour: number): EnvironmentSnapshot["timeOfDay"] {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

/**
 * Collect a fresh environment snapshot. Uses cached GPS if within TTL.
 * Time fields are always fresh (computed at call time).
 */
export async function collectEnvironment(): Promise<EnvironmentSnapshot> {
  const now = new Date();
  const hour = now.getHours();

  // Time/timezone is always fresh
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offsetMin = now.getTimezoneOffset();
  const offsetH = Math.abs(Math.floor(offsetMin / 60));
  const offsetM = Math.abs(offsetMin % 60);
  const sign = offsetMin <= 0 ? "+" : "-";
  const utcOffset = `UTC${sign}${offsetH}${offsetM > 0 ? `:${String(offsetM).padStart(2, "0")}` : ""}`;

  // Reuse cached GPS if still fresh
  if (cachedSnapshot && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return {
      ...cachedSnapshot,
      localTime: now.toISOString(),
      utcOffset,
      timeOfDay: getTimeOfDay(hour),
    };
  }

  let latitude: number | null = null;
  let longitude: number | null = null;

  try {
    const pos = await getPosition();
    if (pos) {
      latitude = Math.round(pos.coords.latitude * 1000) / 1000;
      longitude = Math.round(pos.coords.longitude * 1000) / 1000;
    }
  } catch {
    log.debug("Geolocation unavailable or denied");
  }

  const snapshot: EnvironmentSnapshot = {
    localTime: now.toISOString(),
    timezone,
    utcOffset,
    timeOfDay: getTimeOfDay(hour),
    latitude,
    longitude,
  };

  cachedSnapshot = snapshot;
  cacheTimestamp = Date.now();
  return snapshot;
}
