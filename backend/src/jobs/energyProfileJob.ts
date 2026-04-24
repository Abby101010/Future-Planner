/* ──────────────────────────────────────────────────────────
   Starward — Energy Profile nightly aggregator (Initiative B Phase 3)

   Pulls the last 30 days of daily_tasks for a single user, builds
   per-(hour, dayOfWeek, category) completion-rate stats, and upserts
   them into behavior_profile_entries via the energyProfile service.

   Invoked by the scheduler cron (see scheduler/index.ts) at each user's
   local ENERGY_PROFILE_HOUR. Must run inside a requestContext so the
   repos can scope by userId.

   Any failure is logged and swallowed — an aggregation hiccup must not
   break the cron loop for other users.
   ────────────────────────────────────────────────────────── */

import * as repos from "../repositories";
import {
  computeHourSlotStats,
  persistHourSlotStats,
  ENERGY_DEFAULT_CATEGORY,
  type EnergyObservation,
} from "../services/energyProfile";

/** Look-back window. 30 days lines up with how long an EMA takes to
 *  decay; extending further costs DB rows with diminishing value. */
const LOOKBACK_DAYS = 30;

function isoDateNDaysAgo(n: number, reference: Date = new Date()): string {
  const d = new Date(reference);
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0]!;
}

function todayIsoDate(reference: Date = new Date()): string {
  return reference.toISOString().split("T")[0]!;
}

/** Parse "HH:MM" into an hour 0..23. Returns undefined on failure. */
function parseScheduledHour(hhmm: unknown): number | undefined {
  if (typeof hhmm !== "string") return undefined;
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m) return undefined;
  const h = parseInt(m[1], 10);
  if (!Number.isFinite(h) || h < 0 || h > 23) return undefined;
  return h;
}

/** Extract the scheduled local hour from either the Phase-A ISO column
 *  or the legacy payload.scheduledTime HH:MM field. The ISO column is
 *  timezone-naive today (matcher writes `YYYY-MM-DDTHH:MM:00`) so the
 *  HH substring is the local hour. */
function deriveScheduledHour(task: {
  scheduledStartIso: string | null;
  payload: Record<string, unknown>;
}): number | undefined {
  if (task.scheduledStartIso) {
    const isoHour = parseInt(task.scheduledStartIso.slice(11, 13), 10);
    if (Number.isFinite(isoHour) && isoHour >= 0 && isoHour <= 23) return isoHour;
  }
  return parseScheduledHour(task.payload?.scheduledTime);
}

export async function runEnergyProfileJob(): Promise<{
  observations: number;
  bucketsWritten: number;
}> {
  const start = isoDateNDaysAgo(LOOKBACK_DAYS);
  const end = todayIsoDate();
  const tasks = await repos.dailyTasks.listForDateRange(start, end);

  const observations: EnergyObservation[] = [];
  for (const t of tasks) {
    const hour = deriveScheduledHour(t);
    if (hour === undefined) continue;
    const rawCategory = (t.payload?.category as string | undefined) ?? "";
    const category = rawCategory.trim() || ENERGY_DEFAULT_CATEGORY;
    observations.push({
      date: t.date,
      scheduledHour: hour,
      category,
      completed: t.completed,
    });
  }

  const stats = computeHourSlotStats(observations);
  await persistHourSlotStats(stats);

  return { observations: observations.length, bucketsWritten: stats.length };
}
