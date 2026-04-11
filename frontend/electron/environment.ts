/* ──────────────────────────────────────────────────────────
   NorthStar — Environment Context

   Captures real-time environment data:
   - Current time & timezone
   - GPS location (lat/long) via Chromium geolocation
   - Reverse-geocoded place name (city, country)
   - Local weather conditions (future)

   This context is injected into every AI prompt so the
   model knows WHERE and WHEN the user is.
   ────────────────────────────────────────────────────────── */

import { BrowserWindow } from "electron";

export interface EnvironmentContext {
  timestamp: string;           // ISO 8601
  timeOfDay: string;           // "morning" | "afternoon" | "evening" | "night"
  dayOfWeek: string;           // "Monday", "Tuesday", etc.
  timezone: string;            // e.g. "America/New_York"
  utcOffset: string;           // e.g. "+05:30"
  localTime: string;           // e.g. "2:35 PM"
  location: {
    latitude: number;
    longitude: number;
    accuracy: number;          // meters
    city?: string;
    region?: string;
    country?: string;
  } | null;
  locationError?: string;
}

/** Cached location — updated periodically */
let cachedLocation: EnvironmentContext["location"] = null;
let cachedLocationError: string | undefined;
let lastLocationFetch = 0;
const LOCATION_CACHE_MS = 5 * 60 * 1000; // refresh every 5 minutes

/**
 * Fetch GPS coordinates from the renderer process via Chromium's
 * geolocation API (which uses WiFi/IP/GPS depending on platform).
 */
async function fetchLocation(win: BrowserWindow | null): Promise<void> {
  if (!win) return;

  // Don't re-fetch if cache is fresh
  if (Date.now() - lastLocationFetch < LOCATION_CACHE_MS && cachedLocation) return;

  try {
    const result = await win.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error("Geolocation not supported"));
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }),
          (err) => reject(new Error(err.message)),
          { timeout: 10000, enableHighAccuracy: false, maximumAge: 300000 }
        );
      });
    `);

    cachedLocation = result;
    cachedLocationError = undefined;
    lastLocationFetch = Date.now();

    // Reverse geocode to get city/region/country
    try {
      const geo = await win.webContents.executeJavaScript(`
        fetch("https://nominatim.openstreetmap.org/reverse?lat=${result.latitude}&lon=${result.longitude}&format=json&zoom=10", {
          headers: { "User-Agent": "NorthStar-App/1.0" }
        })
        .then(r => r.json())
        .then(data => ({
          city: data.address?.city || data.address?.town || data.address?.village || null,
          region: data.address?.state || data.address?.county || null,
          country: data.address?.country || null,
        }))
        .catch(() => null);
      `);
      if (geo && cachedLocation) {
        cachedLocation.city = geo.city || undefined;
        cachedLocation.region = geo.region || undefined;
        cachedLocation.country = geo.country || undefined;
      }
    } catch {
      // Reverse geocode is best-effort
    }
  } catch (err) {
    cachedLocationError = err instanceof Error ? err.message : String(err);
  }
}

/**
 * Get the current environment context.
 * Call this before every AI request.
 */
export async function getEnvironmentContext(
  win: BrowserWindow | null
): Promise<EnvironmentContext> {
  // Fetch/refresh location in background
  await fetchLocation(win).catch(() => {});

  const now = new Date();
  const hour = now.getHours();

  let timeOfDay: string;
  if (hour < 6) timeOfDay = "night";
  else if (hour < 12) timeOfDay = "morning";
  else if (hour < 17) timeOfDay = "afternoon";
  else if (hour < 21) timeOfDay = "evening";
  else timeOfDay = "night";

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const offsetMinutes = -now.getTimezoneOffset();
  const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
  const offsetMins = Math.abs(offsetMinutes) % 60;
  const offsetSign = offsetMinutes >= 0 ? "+" : "-";
  const utcOffset = `${offsetSign}${String(offsetHours).padStart(2, "0")}:${String(offsetMins).padStart(2, "0")}`;

  let timezone: string;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timezone = "Unknown";
  }

  return {
    timestamp: now.toISOString(),
    timeOfDay,
    dayOfWeek: dayNames[now.getDay()],
    timezone,
    utcOffset,
    localTime: now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    location: cachedLocation,
    locationError: cachedLocationError,
  };
}

/**
 * Format environment context as a string block for AI prompts.
 */
export function formatEnvironmentContext(env: EnvironmentContext): string {
  const lines = [
    "=== ENVIRONMENT ===",
    `Time: ${env.localTime} (${env.timeOfDay})`,
    `Day: ${env.dayOfWeek}`,
    `Timezone: ${env.timezone} (UTC${env.utcOffset})`,
  ];

  if (env.location) {
    const loc = env.location;
    const place = [loc.city, loc.region, loc.country].filter(Boolean).join(", ");
    lines.push(`Location: ${place || `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`}`);
    if (place) {
      lines.push(`GPS: ${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)} (±${Math.round(loc.accuracy)}m)`);
    }
  } else if (env.locationError) {
    lines.push(`Location: unavailable (${env.locationError})`);
  }

  lines.push("===================");
  return lines.join("\n");
}
