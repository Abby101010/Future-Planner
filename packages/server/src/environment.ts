/* NorthStar server — Environment context enrichment
 *
 * Receives the client's EnvironmentSnapshot (local time, timezone, GPS)
 * and enriches it with weather data from Open-Meteo (free, no API key).
 * Formats everything into the `_environmentContextFormatted` string
 * that AI handlers inject into their prompts.
 */

/** Shape the client sends alongside AI payloads. */
export interface ClientEnvironment {
  localTime: string;
  timezone: string;
  utcOffset: string;
  timeOfDay: "morning" | "afternoon" | "evening" | "night";
  latitude: number | null;
  longitude: number | null;
}

interface WeatherData {
  temperature: number;
  condition: string;
  humidity: number;
  windSpeed: number;
  feelsLike: number;
}

// WMO Weather interpretation codes → human-readable descriptions
const WMO_CODES: Record<number, string> = {
  0: "clear sky",
  1: "mainly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "foggy",
  48: "depositing rime fog",
  51: "light drizzle",
  53: "moderate drizzle",
  55: "dense drizzle",
  56: "light freezing drizzle",
  57: "dense freezing drizzle",
  61: "slight rain",
  63: "moderate rain",
  65: "heavy rain",
  66: "light freezing rain",
  67: "heavy freezing rain",
  71: "slight snowfall",
  73: "moderate snowfall",
  75: "heavy snowfall",
  77: "snow grains",
  80: "slight rain showers",
  81: "moderate rain showers",
  82: "violent rain showers",
  85: "slight snow showers",
  86: "heavy snow showers",
  95: "thunderstorm",
  96: "thunderstorm with slight hail",
  99: "thunderstorm with heavy hail",
};

/** Cache weather results for 30 minutes per lat/lon bucket. */
const weatherCache = new Map<string, { data: WeatherData; ts: number }>();
const WEATHER_CACHE_TTL = 30 * 60 * 1000;

function cacheKey(lat: number, lon: number): string {
  // Round to 1 decimal to bucket nearby locations
  return `${Math.round(lat * 10) / 10},${Math.round(lon * 10) / 10}`;
}

/**
 * Fetch current weather from Open-Meteo (free, no API key required).
 * Returns null on any failure — weather is a nice-to-have, never blocking.
 */
async function fetchWeather(
  lat: number,
  lon: number,
): Promise<WeatherData | null> {
  const key = cacheKey(lat, lon);
  const cached = weatherCache.get(key);
  if (cached && Date.now() - cached.ts < WEATHER_CACHE_TTL) {
    return cached.data;
  }

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
      `&temperature_unit=celsius&wind_speed_unit=kmh`;

    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;

    const json = (await resp.json()) as {
      current?: {
        temperature_2m?: number;
        relative_humidity_2m?: number;
        apparent_temperature?: number;
        weather_code?: number;
        wind_speed_10m?: number;
      };
    };

    const c = json.current;
    if (!c) return null;

    const data: WeatherData = {
      temperature: Math.round(c.temperature_2m ?? 0),
      feelsLike: Math.round(c.apparent_temperature ?? c.temperature_2m ?? 0),
      condition: WMO_CODES[c.weather_code ?? 0] ?? "unknown",
      humidity: Math.round(c.relative_humidity_2m ?? 0),
      windSpeed: Math.round(c.wind_speed_10m ?? 0),
    };

    weatherCache.set(key, { data, ts: Date.now() });
    return data;
  } catch {
    return null;
  }
}

/**
 * Reverse-geocode coordinates to a city name via Open-Meteo's geocoding.
 * Uses a simple cache. Returns null on failure.
 */
const geoCache = new Map<string, { city: string; ts: number }>();

async function reverseGeocode(
  lat: number,
  lon: number,
): Promise<string | null> {
  const key = cacheKey(lat, lon);
  const cached = geoCache.get(key);
  if (cached && Date.now() - cached.ts < WEATHER_CACHE_TTL) {
    return cached.city;
  }

  try {
    // Open-Meteo doesn't have reverse geocoding. Use a free alternative.
    const url = `https://geocode.maps.co/reverse?lat=${lat}&lon=${lon}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;

    const json = (await resp.json()) as {
      address?: {
        city?: string;
        town?: string;
        village?: string;
        state?: string;
        country?: string;
      };
    };

    const a = json.address;
    if (!a) return null;

    const city = a.city || a.town || a.village || "Unknown";
    const location = a.state
      ? `${city}, ${a.state}, ${a.country || ""}`
      : `${city}, ${a.country || ""}`;

    geoCache.set(key, { city: location.trim(), ts: Date.now() });
    return location.trim();
  } catch {
    return null;
  }
}

/**
 * Enrich an AI payload with `_environmentContextFormatted` based on
 * the client's environment snapshot. Fetches weather if GPS is available.
 *
 * Mutates `payload` in-place and returns it for chaining.
 */
export async function enrichWithEnvironment<
  T extends Record<string, unknown>,
>(
  payload: T,
  env: ClientEnvironment | undefined | null,
): Promise<T> {
  if (!env) return payload;

  const lines: string[] = ["ENVIRONMENT:"];

  // Time context — format in the USER's timezone, not the server's (UTC on Fly)
  const localDate = new Date(env.localTime);
  const timeStr = localDate.toLocaleTimeString("en-US", {
    timeZone: env.timezone || "UTC",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  lines.push(`  Local time: ${timeStr} (${env.timeOfDay})`);
  lines.push(`  Timezone: ${env.timezone} (${env.utcOffset})`);

  // Location + weather (only if GPS available)
  if (env.latitude != null && env.longitude != null) {
    // Fetch weather and location in parallel
    const [weather, location] = await Promise.all([
      fetchWeather(env.latitude, env.longitude),
      reverseGeocode(env.latitude, env.longitude),
    ]);

    if (location) {
      lines.push(`  Location: ${location}`);
    }

    if (weather) {
      const tempF = Math.round(weather.temperature * 9 / 5 + 32);
      lines.push(
        `  Weather: ${weather.condition}, ${weather.temperature}°C / ${tempF}°F ` +
        `(feels like ${Math.round(weather.feelsLike * 9 / 5 + 32)}°F), ` +
        `humidity ${weather.humidity}%, wind ${weather.windSpeed} km/h`,
      );

      // Add weather-aware suggestions for the AI
      if (weather.temperature < 0 || weather.condition.includes("snow") || weather.condition.includes("freezing")) {
        lines.push(`  ⚠ Cold/icy conditions — outdoor tasks may be difficult`);
      } else if (weather.temperature > 35) {
        lines.push(`  ⚠ Extreme heat — suggest indoor activities, stay hydrated`);
      }
      if (weather.condition.includes("rain") || weather.condition.includes("thunderstorm")) {
        lines.push(`  ⚠ Rainy weather — outdoor errands may need rescheduling`);
      }
    }
  }

  (payload as Record<string, unknown>)._environmentContextFormatted = lines.join("\n");
  return payload;
}
