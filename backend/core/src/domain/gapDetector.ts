/* ──────────────────────────────────────────────────────────
   NorthStar — Gap Detector (Initiative B Phase 4)

   Pure utility: given today's booked ranges (calendar events +
   already-scheduled tasks) and the user's working-hours window,
   emit every gap ≥ MIN_GAP_MINUTES.

   Booked ranges use naive local-time ISO strings
   (`YYYY-MM-DDTHH:MM:00`) consistent with the rest of the
   codebase — returned gaps do too, so callers can persist them
   alongside legacy HH:MM fields without timezone ceremony.
   ────────────────────────────────────────────────────────── */

export const MIN_GAP_MINUTES = 15;

export interface BookedRange {
  startIso: string;
  endIso: string;
}

export interface CalendarGap {
  startIso: string;
  endIso: string;
  durationMinutes: number;
}

export interface DetectGapsArgs {
  /** YYYY-MM-DD — anchors the day being analysed. */
  dateIso: string;
  booked: BookedRange[];
  /** Local hour window in which gaps are considered (e.g. 9..18). */
  workingHours: { startHour: number; endHour: number };
  /** Override default (15 minutes) if the caller wants larger gaps only. */
  minGapMinutes?: number;
}

function buildIso(date: string, totalMinutes: number): string {
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const mm = String(totalMinutes % 60).padStart(2, "0");
  return `${date}T${hh}:${mm}:00`;
}

/** Extract total-minutes-from-midnight from a naive local ISO or an
 *  ISO matching today's dateIso. Returns null if the date prefix doesn't
 *  match (booking on a different day). */
function parseLocalMinutes(iso: string, dateIso: string): number | null {
  // Accept "YYYY-MM-DDTHH:MM..." with or without trailing seconds / TZ.
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!match) return null;
  if (match[1] !== dateIso) return null;
  const h = parseInt(match[2], 10);
  const m = parseInt(match[3], 10);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

export function detectGaps(args: DetectGapsArgs): CalendarGap[] {
  const {
    dateIso,
    booked,
    workingHours,
    minGapMinutes = MIN_GAP_MINUTES,
  } = args;

  const dayStart = workingHours.startHour * 60;
  const dayEnd = workingHours.endHour * 60;
  if (dayStart >= dayEnd) return [];

  const clipped = booked
    .map((b) => {
      const s = parseLocalMinutes(b.startIso, dateIso);
      const e = parseLocalMinutes(b.endIso, dateIso);
      if (s === null || e === null || e <= s) return null;
      return { start: Math.max(dayStart, s), end: Math.min(dayEnd, e) };
    })
    .filter((x): x is { start: number; end: number } => x !== null && x.end > x.start)
    .sort((a, b) => a.start - b.start);

  const merged: Array<{ start: number; end: number }> = [];
  for (const b of clipped) {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) {
      last.end = Math.max(last.end, b.end);
    } else {
      merged.push({ ...b });
    }
  }

  const gaps: CalendarGap[] = [];
  let cursor = dayStart;
  for (const b of merged) {
    if (b.start > cursor) {
      const durationMinutes = b.start - cursor;
      if (durationMinutes >= minGapMinutes) {
        gaps.push({
          startIso: buildIso(dateIso, cursor),
          endIso: buildIso(dateIso, b.start),
          durationMinutes,
        });
      }
    }
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < dayEnd) {
    const durationMinutes = dayEnd - cursor;
    if (durationMinutes >= minGapMinutes) {
      gaps.push({
        startIso: buildIso(dateIso, cursor),
        endIso: buildIso(dateIso, dayEnd),
        durationMinutes,
      });
    }
  }

  return gaps;
}
