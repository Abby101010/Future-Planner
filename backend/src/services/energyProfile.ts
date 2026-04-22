/* ──────────────────────────────────────────────────────────
   NorthStar — Energy Profile (Initiative B Phase 3)

   Aggregates the user's recent completion signals into a
   per-(hour, dayOfWeek, category) completion-rate weight map.
   Writes to `behavior_profile_entries` under category="energy"
   so B-2's slot matcher can use it as a data-driven tie-break.

   Storage shape:
     category="energy"
     signal="hour:{H}:dow:{D}:{taskCategory}"
     weight=completionRate (0..1)
     payload={ hour, dayOfWeek, taskCategory, sampleCount }

   Aged via EMA (α=0.2) against the existing weight so older
   patterns fade over weeks without being overwritten in one
   run of a small sample.
   ────────────────────────────────────────────────────────── */

import * as repos from "../repositories";

/** Nightly job blends new stats into existing weights at this rate. */
export const ENERGY_PROFILE_EMA_ALPHA = 0.2;

/** Category suffix used when a task has no explicit category tag. */
export const ENERGY_DEFAULT_CATEGORY = "general";

export interface HourSlotStat {
  /** 0..23 — local hour of the observation. */
  hour: number;
  /** 0=Mon..6=Sun (matches TimeBlock convention used elsewhere). */
  dayOfWeek: number;
  /** Task-level category key (e.g. "learning", "networking"). */
  category: string;
  /** completed / total within the bucket, clamped to [0,1]. */
  completionRate: number;
  /** total observations (both completed and not). */
  sampleCount: number;
}

export interface EnergyObservation {
  /** YYYY-MM-DD — used to derive dayOfWeek via the 0=Mon convention. */
  date: string;
  /** 0..23 local hour of the scheduled slot, or undefined if the task had no time block. */
  scheduledHour: number | undefined;
  /** Task-level category. Falls back to ENERGY_DEFAULT_CATEGORY when absent. */
  category: string;
  completed: boolean;
}

/** Pure aggregator. Buckets observations by (hour, dayOfWeek, category) and
 *  returns one HourSlotStat per non-empty bucket. Observations missing a
 *  scheduledHour are dropped — we can't learn energy patterns for untimed work. */
export function computeHourSlotStats(
  observations: EnergyObservation[],
): HourSlotStat[] {
  const buckets = new Map<
    string,
    { hour: number; dayOfWeek: number; category: string; completed: number; total: number }
  >();

  for (const obs of observations) {
    if (obs.scheduledHour === undefined || obs.scheduledHour === null) continue;
    if (!Number.isFinite(obs.scheduledHour)) continue;
    const hour = Math.max(0, Math.min(23, Math.floor(obs.scheduledHour)));
    const dayOfWeek = dateStringToDayOfWeek(obs.date);
    if (dayOfWeek === null) continue;
    const category = obs.category?.trim() || ENERGY_DEFAULT_CATEGORY;
    const key = `${hour}:${dayOfWeek}:${category}`;
    const existing = buckets.get(key) ?? {
      hour,
      dayOfWeek,
      category,
      completed: 0,
      total: 0,
    };
    existing.total += 1;
    if (obs.completed) existing.completed += 1;
    buckets.set(key, existing);
  }

  const stats: HourSlotStat[] = [];
  for (const b of buckets.values()) {
    if (b.total === 0) continue;
    stats.push({
      hour: b.hour,
      dayOfWeek: b.dayOfWeek,
      category: b.category,
      completionRate: Math.max(0, Math.min(1, b.completed / b.total)),
      sampleCount: b.total,
    });
  }
  return stats;
}

/** Map YYYY-MM-DD to the 0=Mon..6=Sun convention. Returns null on parse
 *  failure so the aggregator can skip garbage rows without throwing. */
function dateStringToDayOfWeek(date: string): number | null {
  const [y, m, d] = date.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return null;
  const js = new Date(y, m - 1, d).getDay();
  if (Number.isNaN(js)) return null;
  return js === 0 ? 6 : js - 1;
}

export function signalKey(stat: {
  hour: number;
  dayOfWeek: number;
  category: string;
}): string {
  return `hour:${stat.hour}:dow:${stat.dayOfWeek}:${stat.category}`;
}

export function entryId(stat: {
  hour: number;
  dayOfWeek: number;
  category: string;
}): string {
  return `energy:${signalKey(stat)}`;
}

/** Upsert each stat into behavior_profile_entries. Blends the new
 *  completionRate with any existing weight via EMA so a single sparse run
 *  can't overwrite months of trend. */
export async function persistHourSlotStats(stats: HourSlotStat[]): Promise<void> {
  if (stats.length === 0) return;
  const existing = await repos.behaviorProfile.listByCategory("energy");
  const existingBySignal = new Map(existing.map((e) => [e.signal, e]));

  for (const stat of stats) {
    const key = signalKey(stat);
    const prev = existingBySignal.get(key);
    const blended = prev
      ? ENERGY_PROFILE_EMA_ALPHA * stat.completionRate +
        (1 - ENERGY_PROFILE_EMA_ALPHA) * prev.weight
      : stat.completionRate;
    await repos.behaviorProfile.insert({
      id: entryId(stat),
      category: "energy",
      signal: key,
      weight: Math.max(0, Math.min(1, blended)),
      observedAt: new Date().toISOString(),
      payload: {
        hour: stat.hour,
        dayOfWeek: stat.dayOfWeek,
        taskCategory: stat.category,
        sampleCount: stat.sampleCount,
      },
    });
  }
}

/** Read energy weights for today → shape them for the slot matcher.
 *  Only rows matching the given dayOfWeek are returned; the matcher
 *  consumes them as a tie-break, not a constraint. */
export async function loadEnergyStatsForDayOfWeek(
  dayOfWeek: number,
): Promise<HourSlotStat[]> {
  const entries = await repos.behaviorProfile.listByCategory("energy");
  const stats: HourSlotStat[] = [];
  for (const e of entries) {
    const payload = e.payload as Record<string, unknown> | null;
    const hour = Number(payload?.hour);
    const dow = Number(payload?.dayOfWeek);
    const category = String(payload?.taskCategory ?? ENERGY_DEFAULT_CATEGORY);
    const sampleCount = Number(payload?.sampleCount ?? 0);
    if (!Number.isFinite(hour) || !Number.isFinite(dow)) continue;
    if (dow !== dayOfWeek) continue;
    stats.push({
      hour,
      dayOfWeek: dow,
      category,
      completionRate: e.weight,
      sampleCount: Number.isFinite(sampleCount) ? sampleCount : 0,
    });
  }
  return stats;
}
