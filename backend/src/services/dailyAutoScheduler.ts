/* Starward server — Daily auto-scheduler (L0, deterministic)
 *
 * Pure-algorithm placement of unscheduled daily_tasks into the user's
 * working-hours envelope. No LLM call. Runs as the third stage of
 * `fireDailyMutationPipeline` after triage (which orders by tier/cost)
 * and the duration estimator (which populates estimatedDurationMinutes).
 *
 * Contract:
 *   - Only writes scheduledStartIso/scheduledEndIso for tasks where
 *     BOTH are currently NULL. User manual placements are never
 *     overwritten — the null check is the safety rail.
 *   - Skips tasks without estimatedDurationMinutes (the next pipeline
 *     fire after the estimator completes will catch them).
 *   - Respects already-scheduled tasks as fixed busy blocks. Walks
 *     remaining working-hours capacity and places sequentially in
 *     triage order: tier ascending (lifetime → quarter → week → day),
 *     cognitiveCost descending.
 *   - Idempotent. Subsequent calls re-classify all rows; ones placed
 *     by a prior run are now "fixed" and filtered out of the needs
 *     list — no double-placement.
 *
 * What this DOES NOT do (deliberate, document the why):
 *   - Calendar events: the codebase merged calendar events into
 *     daily_tasks (Phase ~0007 unify). Tasks with scheduledStartIso
 *     set ARE the fixed blocks; there's no separate event source to
 *     consider. If/when external calendar sync (Google etc.) lands,
 *     extend the busy-blocks builder below.
 *   - Inter-task buffers: places back-to-back. Add a configurable
 *     `BREAK_MINUTES` later if user feedback demands.
 *   - Lookahead beyond today: only schedules the requested date. The
 *     pipeline fires per-date for cross-day mutations.
 *   - Weekend/holiday awareness: uses a single working-hours window
 *     (default 9-18 local) for every day. Configurable per-user later
 *     when settings UI lands.
 *
 * Why this matters: prior to 2026-04-26, materialized tasks were
 * inserted with scheduledStartIso=NULL and no service ever placed
 * them. The day-view calendar showed "Scheduled 10, Total time 0h"
 * with no draggable blocks because DayBlock falls back to new Date()
 * on null. Auto-scheduling at L0 means every day has a sensible
 * starting placement the user can adjust.
 */

import * as repos from "../repositories";
import { timezoneStore, getEffectiveDate } from "../dateUtils";
import { composeIso } from "../repositories/dailyTasksRepo";

/** Default working-hours envelope. Configurable per-user later via
 *  users.settings; today's MVP uses 9 AM – 6 PM local for everyone. */
const DEFAULT_WORKING_START_HOUR = 9;
const DEFAULT_WORKING_END_HOUR = 18;

/** Tier ranking matches services/dailyTriage.ts:53 — keep in sync. */
const TIER_RANK: Record<string, number> = {
  lifetime: 0,
  quarter: 1,
  week: 2,
  day: 3,
};

export interface AutoScheduleResult {
  date: string;
  considered: number;
  placed: number;
  skipped: number;
  unfit: number;
}

/** Decompose an Anthropic-style ISO timestamp ("...Z") into local
 *  minutes-from-midnight in `tz`. Returns null if the date prefix in
 *  the user's tz doesn't match `dateIso` (the timestamp is on a
 *  different local day). */
function isoToLocalMinutes(
  iso: string,
  dateIso: string,
  tz: string,
): number | null {
  try {
    const d = new Date(iso);
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(d).reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
    const localDate = `${parts.year}-${parts.month}-${parts.day}`;
    if (localDate !== dateIso) return null;
    const h = Number(parts.hour) % 24; // "24" can appear in some locales
    const m = Number(parts.minute);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  } catch {
    return null;
  }
}

/** "HH:MM" from a minutes-from-midnight integer. */
function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Place unscheduled tasks for `date` into the user's working-hours
 * envelope. Returns counts so the caller can log/telemetry.
 *
 * Failure-tolerant: per-task update errors are caught and logged so
 * one bad row doesn't abort the whole pass.
 */
export async function autoScheduleDay(
  date?: string,
): Promise<AutoScheduleResult> {
  const targetDate = date ?? getEffectiveDate();
  const tz = timezoneStore.getStore() || "UTC";
  const result: AutoScheduleResult = {
    date: targetDate,
    considered: 0,
    placed: 0,
    skipped: 0,
    unfit: 0,
  };

  const tasks = await repos.dailyTasks.listForDate(targetDate);
  if (tasks.length === 0) return result;

  // Partition: fixed (must stay where they are) vs needs (placement candidates)
  type LocalRange = { startMin: number; endMin: number };
  const fixed: LocalRange[] = [];
  const needs: typeof tasks = [];

  for (const t of tasks) {
    if (t.completed) continue;
    const pl = (t.payload ?? {}) as Record<string, unknown>;
    if (pl.skipped) continue;

    if (t.scheduledStartIso && t.scheduledEndIso) {
      const startMin = isoToLocalMinutes(t.scheduledStartIso, targetDate, tz);
      const endMin = isoToLocalMinutes(t.scheduledEndIso, targetDate, tz);
      if (startMin !== null && endMin !== null && endMin > startMin) {
        fixed.push({ startMin, endMin });
      }
      // If a task has scheduledStartIso but the times don't decode in
      // this tz / date (cross-day timestamp, malformed), treat it as
      // fixed-but-unknown — leave it alone, don't try to reschedule.
      continue;
    }

    if (!t.estimatedDurationMinutes || t.estimatedDurationMinutes <= 0) {
      result.skipped++;
      continue; // estimator hasn't populated yet — next pipeline fire catches it
    }

    needs.push(t);
  }

  result.considered = needs.length;
  if (needs.length === 0) return result;

  // Triage-order placement: tier ascending, then cognitiveCost descending.
  // Falls back to creation order if those fields are unset (un-triaged).
  needs.sort((a, b) => {
    const aTier = TIER_RANK[a.tier ?? "week"] ?? 2.5;
    const bTier = TIER_RANK[b.tier ?? "week"] ?? 2.5;
    if (aTier !== bTier) return aTier - bTier;
    const aCost = a.cognitiveCost ?? 0;
    const bCost = b.cognitiveCost ?? 0;
    return bCost - aCost;
  });

  // Sort fixed blocks by start time so the cursor walk is monotonic.
  fixed.sort((a, b) => a.startMin - b.startMin);

  const dayStart = DEFAULT_WORKING_START_HOUR * 60;
  const dayEnd = DEFAULT_WORKING_END_HOUR * 60;
  let cursor = dayStart;

  for (const task of needs) {
    const durationMin = task.estimatedDurationMinutes!;

    // Advance cursor past any fixed block that overlaps the next slot.
    // Re-loop because skipping one block may leave us inside another.
    let placed = false;
    let attempts = 0;
    while (cursor + durationMin <= dayEnd && attempts < fixed.length + 1) {
      const blocking = fixed.find(
        (b) => b.startMin < cursor + durationMin && b.endMin > cursor,
      );
      if (blocking) {
        cursor = blocking.endMin;
        attempts++;
        continue;
      }

      // Slot is free. Compose UTC ISO for the row and write it.
      const startHHMM = minutesToHHMM(cursor);
      const endHHMM = minutesToHHMM(cursor + durationMin);
      const startIso = composeIso(targetDate, startHHMM, tz);
      const endIso = composeIso(targetDate, endHHMM, tz);
      if (!startIso || !endIso) {
        // Shouldn't happen — composeIso only fails on malformed inputs.
        result.unfit++;
        break;
      }
      try {
        await repos.dailyTasks.update(task.id, {
          scheduledStartIso: startIso,
          scheduledEndIso: endIso,
          payload: {
            scheduledTime: startHHMM,
            scheduledEndTime: endHHMM,
            scheduledByAutoSchedulerAt: new Date().toISOString(),
          },
        });
        result.placed++;
        // The newly-placed task is now a fixed block for subsequent
        // placements. Insert in sorted position to keep `fixed` sorted.
        const newRange: LocalRange = {
          startMin: cursor,
          endMin: cursor + durationMin,
        };
        const insertAt = fixed.findIndex((b) => b.startMin > cursor);
        if (insertAt < 0) fixed.push(newRange);
        else fixed.splice(insertAt, 0, newRange);
        cursor = cursor + durationMin;
        placed = true;
      } catch (err) {
        console.warn(
          `[auto-scheduler] update task ${task.id} failed:`,
          err,
        );
        result.unfit++;
      }
      break;
    }
    if (!placed && result.placed + result.unfit + result.skipped < result.considered) {
      // Couldn't fit this task in the remaining day. Record and keep
      // walking — subsequent (smaller) tasks might still fit a tail
      // gap, but cursor is already past most of the day so unlikely.
      result.unfit++;
    }
  }

  if (result.placed > 0 || result.unfit > 0) {
    console.log(
      `[auto-scheduler] date=${targetDate} considered=${result.considered} placed=${result.placed} skipped=${result.skipped} unfit=${result.unfit}`,
    );
  }
  return result;
}
