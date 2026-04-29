/* cognitiveLoadScheduler — pure-algorithm matcher that assigns
 * scheduled_start_time to today's tasks based on each task's
 * cognitive load and the user's learned energy curve.
 *
 * Reads:
 *   - daily_tasks.cognitive_load + cognitive_cost (Phase B columns,
 *     migration 0011). Pre-populated by the goal-breakdown agent
 *     (Phase A) or by priorityAnnotator (existing fallback).
 *   - behavior_profile_entries energy stats via
 *     services/energyProfile.ts:loadEnergyStatsForDayOfWeek (per
 *     hour × day-of-week × category completion rates with EMA
 *     smoothing α=0.2).
 *
 * Writes:
 *   - daily_tasks.scheduled_start_time + scheduled_end_time only.
 *   - Never auto-creates tasks. Never overwrites an explicitly
 *     user-set time block (`payload.userTimeBlock === true`).
 *
 * Algorithm:
 *   1. Build a 24-element energy curve for the date's day-of-week.
 *      Average completionRate across categories per hour, smoothed.
 *      Falls back to a morning-peak default when the user has <14
 *      days of energy samples (new-user state).
 *   2. Mask hours that conflict with the existing busy schedule
 *      (`getScheduleContext` events) and hours outside the user's
 *      waking window (default 7:00–22:00).
 *   3. Sort tasks by load: high → medium → low; tiebreak by
 *      cognitiveCost desc, then estimatedDurationMinutes desc.
 *   4. Greedy assign: for each task, pick the highest-rated
 *      contiguous slot in the candidate window. High-load tasks
 *      are restricted to the top-third of hours (peak window);
 *      medium → top half; low → any free hour.
 *   5. Snap starts to 15-min grid. Sum durations, leave 15-min
 *      buffer between high-load tasks (avoid back-to-back deep
 *      work).
 *
 * If a high-load task can't find a 90+ min contiguous peak slot,
 * its result is `null` — caller (e.g. L0 sweep) should defer the
 * task to a less-crowded day rather than cram into a tiny gap.
 *
 * IMPORTANT: this matcher is deterministic. Same inputs → same
 * output. No AI calls. Idempotent — re-running on a day where
 * everything is already placed produces no changes (existing
 * scheduledStartIso is preserved when matched against the curve).
 */

import * as repos from "../repositories";
import { loadEnergyStatsForDayOfWeek } from "./energyProfile";
import type { DailyTaskRecord } from "../repositories/dailyTasksRepo";

export interface SchedulerSlot {
  taskId: string;
  scheduledStartIso: string;
  scheduledEndIso: string;
}

export interface SchedulerResult {
  slots: SchedulerSlot[];
  /** Task IDs the matcher couldn't place (e.g. high-load on a
   *  crowded day with no 90+ min peak window). Caller should defer
   *  these to another day. */
  deferred: string[];
  /** Source of the energy curve: "user" when ≥14d of samples were
   *  available; "default" otherwise. Logged for observability. */
  curveSource: "user" | "default";
}

/** Days of energy samples required before we trust the user-derived
 *  curve. Below this threshold we fall back to the morning-peak
 *  default. Mirrors the new-user threshold in capacityProfile. */
const MIN_DAYS_FOR_USER_CURVE = 14;

/** Default morning-peak curve. Index 0..23 = hour-of-day weight 0..1.
 *  9–11am is the peak, 1pm–4pm is medium, late evening is low.
 *  Used when the user has <14d of energy data. */
const DEFAULT_MORNING_CURVE = [
  0, 0, 0, 0, 0, 0, 0, // 0-6: sleeping
  0.4, 0.7, 0.95, 1.0, 0.95, // 7-11: morning rise
  0.6, 0.55, 0.7, 0.65, 0.55, // 12-16: post-lunch dip + recovery
  0.45, 0.4, 0.35, 0.3, 0.2, 0.1, 0.05, // 17-23: evening decline
] as const;

/** Hours we consider waking. Tasks won't be placed outside this
 *  window even if no calendar conflicts exist. */
const WAKING_START_HOUR = 7;
const WAKING_END_HOUR = 22;

/** Minimum contiguous minutes for a high-load task. Smaller windows
 *  are not worth the context-switch cost. */
const MIN_HIGH_LOAD_BLOCK_MIN = 90;

/** Build the per-hour energy curve. When user data is sparse, fall
 *  back to morning-peak default. */
async function buildEnergyCurve(
  dayOfWeek: number,
): Promise<{ curve: number[]; source: "user" | "default" }> {
  const stats = await loadEnergyStatsForDayOfWeek(dayOfWeek);
  // Aggregate samples by hour across categories. We require at least
  // MIN_DAYS_FOR_USER_CURVE days of distinct observations before
  // trusting the user-specific curve.
  const totalSamples = stats.reduce((acc, s) => acc + s.sampleCount, 0);
  if (totalSamples < MIN_DAYS_FOR_USER_CURVE) {
    return { curve: [...DEFAULT_MORNING_CURVE], source: "default" };
  }
  const curve = new Array(24).fill(0);
  const weights = new Array(24).fill(0);
  for (const s of stats) {
    if (s.hour < 0 || s.hour > 23) continue;
    const w = Math.max(1, s.sampleCount);
    curve[s.hour] += s.completionRate * w;
    weights[s.hour] += w;
  }
  for (let h = 0; h < 24; h++) {
    curve[h] = weights[h] > 0 ? curve[h] / weights[h] : 0;
  }
  // Normalize so peak hour = 1.0 (preserves shape regardless of
  // overall completion rate).
  const max = Math.max(...curve);
  if (max > 0) {
    for (let h = 0; h < 24; h++) curve[h] = curve[h] / max;
  }
  return { curve, source: "user" };
}

/** Compose a local-day ISO at the given hour:minute. */
function composeLocalIso(date: string, hour: number, minute: number): string {
  const [yyyy, mm, dd] = date.split("-").map(Number);
  const d = new Date(
    yyyy ?? 1970,
    (mm ?? 1) - 1,
    dd ?? 1,
    Math.max(0, Math.min(23, Math.floor(hour))),
    Math.max(0, Math.min(59, Math.floor(minute))),
    0,
    0,
  );
  return d.toISOString();
}

/** Sort key: load priority (high=0, med=1, low=2) → cost desc → duration desc. */
function loadRank(load: string | null): number {
  if (load === "high") return 0;
  if (load === "medium") return 1;
  return 2; // low or null
}

/** The hour-restriction window for each load level. high-load tasks
 *  only land in the top-third of energy hours; medium in top-half;
 *  low anywhere. Returned as a Set of acceptable hours. */
function eligibleHours(curve: number[], load: string | null): Set<number> {
  // Sort hours by curve weight desc, then take top-N according to load.
  const wakingHours = Array.from({ length: 24 }, (_, h) => h).filter(
    (h) => h >= WAKING_START_HOUR && h <= WAKING_END_HOUR,
  );
  const ranked = [...wakingHours].sort((a, b) => curve[b] - curve[a]);
  const total = ranked.length;
  const slice =
    load === "high"
      ? Math.max(3, Math.floor(total / 3))
      : load === "medium"
      ? Math.max(5, Math.floor(total / 2))
      : total;
  return new Set(ranked.slice(0, slice));
}

/** Match a list of tasks (one day's worth) to time slots. Pure
 *  function; no DB writes. Caller persists the resulting slots via
 *  repos.dailyTasks.update. */
export async function matchTasksToHours(
  date: string,
  tasks: DailyTaskRecord[],
  busyHours: Set<number>,
): Promise<SchedulerResult> {
  if (tasks.length === 0) {
    return { slots: [], deferred: [], curveSource: "default" };
  }
  const dow = (new Date(date + "T00:00:00").getDay() + 6) % 7; // 0=Mon..6=Sun
  const { curve, source } = await buildEnergyCurve(dow);

  // Skip tasks the user has manually time-blocked. Their wishes win.
  const candidates = tasks.filter((t) => {
    const pl = t.payload as Record<string, unknown>;
    if (pl.userTimeBlock === true) return false;
    return true;
  });

  // Sort by load desc + cost desc + duration desc.
  const sorted = [...candidates].sort((a, b) => {
    const r = loadRank(a.cognitiveLoad) - loadRank(b.cognitiveLoad);
    if (r !== 0) return r;
    const ca = a.cognitiveCost ?? 0;
    const cb = b.cognitiveCost ?? 0;
    if (ca !== cb) return cb - ca;
    const da = a.estimatedDurationMinutes ?? 30;
    const db = b.estimatedDurationMinutes ?? 30;
    return db - da;
  });

  // Track minute-level occupancy. Each entry = true if the minute is
  // already taken (by an earlier-placed task or a busy hour).
  const occupied = new Array(24 * 60).fill(false);
  for (let h = 0; h < 24; h++) {
    if (busyHours.has(h) || h < WAKING_START_HOUR || h > WAKING_END_HOUR) {
      for (let m = 0; m < 60; m++) occupied[h * 60 + m] = true;
    }
  }

  const slots: SchedulerSlot[] = [];
  const deferred: string[] = [];

  for (const t of sorted) {
    const dur = t.estimatedDurationMinutes ?? 30;
    const eligible = eligibleHours(curve, t.cognitiveLoad);
    const isHigh = t.cognitiveLoad === "high";

    // Search for a contiguous free block. Walk hours sorted by curve
    // weight desc, then within each hour try minute offsets in 15-min
    // increments.
    const hoursByWeight = Array.from(eligible).sort((a, b) => curve[b] - curve[a]);

    let placed = false;
    for (const h of hoursByWeight) {
      for (let mStart = 0; mStart < 60; mStart += 15) {
        const start = h * 60 + mStart;
        const end = start + dur;
        if (end > 24 * 60) continue;
        // High-load tasks need at least MIN_HIGH_LOAD_BLOCK_MIN
        // contiguous free min within the peak window (avoid placing a
        // 30-min high-load task in a 30-min hole and burning the
        // peak slot for shallower work).
        const requiredFree = isHigh ? Math.max(MIN_HIGH_LOAD_BLOCK_MIN, dur) : dur;
        let free = true;
        for (let i = start; i < start + requiredFree; i++) {
          if (occupied[i]) {
            free = false;
            break;
          }
        }
        if (!free) continue;
        // Mark the actual task duration occupied (not the required-free
        // window). The extra free minutes act as a back-to-back buffer.
        for (let i = start; i < end; i++) occupied[i] = true;
        // Add a 15-min cooldown buffer after high-load tasks.
        if (isHigh) {
          for (let i = end; i < Math.min(end + 15, 24 * 60); i++) {
            occupied[i] = true;
          }
        }
        slots.push({
          taskId: t.id,
          scheduledStartIso: composeLocalIso(date, h, mStart),
          scheduledEndIso: composeLocalIso(
            date,
            Math.floor(end / 60),
            end % 60,
          ),
        });
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) {
      deferred.push(t.id);
    }
  }

  return { slots, deferred, curveSource: source };
}

/** Apply a SchedulerResult by writing scheduled_start_time +
 *  scheduled_end_time on each task. Best-effort: per-task failures
 *  log and continue. */
export async function applyMatcherResult(
  result: SchedulerResult,
): Promise<{ updated: number; failed: number }> {
  let updated = 0;
  let failed = 0;
  for (const slot of result.slots) {
    try {
      await repos.dailyTasks.update(slot.taskId, {
        scheduledStartIso: slot.scheduledStartIso,
        scheduledEndIso: slot.scheduledEndIso,
      });
      updated++;
    } catch (err) {
      failed++;
      console.warn(`[cognitiveLoadScheduler] update ${slot.taskId} failed:`, err);
    }
  }
  return { updated, failed };
}
