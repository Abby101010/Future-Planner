/* ──────────────────────────────────────────────────────────
   NorthStar — Time-Block Matcher (Initiative B Phase 2)

   Pure function that assigns today's tasks to slots drawn
   from the user's weeklyAvailability. Runs AFTER the scheduler
   has trimmed by cognitive budget and ordered by tier, so the
   matcher only decides WHICH hour of the day each kept task
   lands on.

   Matching rule:
     cognitiveLoad=high   ↔ importance=3 (deep-work)
     cognitiveLoad=medium ↔ importance=2
     cognitiveLoad=low    ↔ importance=1

   A preference, not a constraint — if no slot of the preferred
   importance has room, the matcher falls back to the next tier
   rather than leave the task unplaced.
   ────────────────────────────────────────────────────────── */

export type TimeBlockMatcherLoad = "high" | "medium" | "low";

export interface AvailabilitySlot {
  /** weekly-grid day: 0=Mon, 1=Tue, ..., 6=Sun */
  day: number;
  /** 0..23 */
  hour: number;
  importance: 1 | 2 | 3;
  label: string;
}

export interface MatcherTask {
  id: string;
  cognitiveLoad: TimeBlockMatcherLoad | undefined;
  durationMinutes: number;
  /** B-3 opt-in: when present, the matcher tie-breaks by the energy weight
   *  for this category first, falling back to the unlabeled weight. */
  category?: string;
}

export interface SlotAssignment {
  taskId: string;
  startIso: string;
  endIso: string;
  slotImportance: 1 | 2 | 3;
}

export interface ExistingAssignment {
  startIso: string;
  endIso: string;
}

/** B-3: data-driven energy weights. When supplied, the matcher uses the
 *  `completionRate` as a tie-break between otherwise-equivalent slots — never
 *  as a constraint. Shape mirrors `packages/server/src/services/energyProfile`
 *  so callers can pass the raw loader output. */
export interface HourEnergyWeight {
  hour: number;
  /** Expected to be pre-filtered to "today's dayOfWeek" by the caller. */
  dayOfWeek: number;
  /** Optional: when set, weight only tie-breaks for tasks of this category. */
  category?: string;
  /** 0..1 — fraction of scheduled tasks historically completed in this slot. */
  completionRate: number;
}

export interface MatchTasksToSlotsArgs {
  tasks: MatcherTask[];
  /** Slots for today ONLY. Caller filters weeklyAvailability by day. */
  slots: AvailabilitySlot[];
  /** YYYY-MM-DD — used to build ISO timestamps. */
  dateIso: string;
  /** Already-booked ranges for today (e.g. calendar events). */
  existingAssignments: ExistingAssignment[];
  /** B-3 opt-in: per-slot completion-rate weights. Caller passes `undefined`
   *  (default) to reproduce B-2 behaviour exactly. */
  hourEnergyWeights?: HourEnergyWeight[];
}

function loadToImportance(load: TimeBlockMatcherLoad | undefined): 1 | 2 | 3 {
  if (load === "high") return 3;
  if (load === "medium") return 2;
  return 1;
}

function loadRank(load: TimeBlockMatcherLoad | undefined): number {
  if (load === "high") return 0;
  if (load === "medium") return 1;
  return 2;
}

function buildIso(date: string, hour: number, minute: number): string {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  // Produce a naive local-time ISO. Callers who need timezone-aware rendering
  // re-compose in the server's dual-write path; the scheduler consumer writes
  // these back to scheduled_start/end ISO columns and derives HH:MM via the
  // same timezone helpers as cmdSetTaskTimeBlock.
  return `${date}T${hh}:${mm}:00`;
}

function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Greedy per-task slot assignment.
 *
 *  Sorts tasks by cognitiveLoad desc (high first). For each task, iterates
 *  slots in (importance distance from preferred, hour ascending) order and
 *  picks the first slot whose remaining minutes can cover the task.
 */
/** Look up the energy weight for a given (hour, taskCategory). Prefers a
 *  category-specific entry; falls back to an entry without a category tag;
 *  returns 0 if nothing matches (neutral tie-break). */
function energyWeightFor(
  weights: HourEnergyWeight[] | undefined,
  hour: number,
  taskCategory: string | undefined,
): number {
  if (!weights || weights.length === 0) return 0;
  if (taskCategory) {
    const exact = weights.find(
      (w) => w.hour === hour && w.category === taskCategory,
    );
    if (exact) return exact.completionRate;
  }
  const untagged = weights.find(
    (w) => w.hour === hour && (w.category === undefined || w.category === ""),
  );
  return untagged ? untagged.completionRate : 0;
}

export function matchTasksToSlots(
  args: MatchTasksToSlotsArgs,
): SlotAssignment[] {
  const { tasks, slots, dateIso, existingAssignments, hourEnergyWeights } = args;
  if (tasks.length === 0 || slots.length === 0) return [];

  // Track remaining-minutes per slot (each slot is a 60-min hour by convention).
  const slotState = slots
    .slice()
    .sort((a, b) => a.hour - b.hour)
    .map((s) => ({ slot: s, remaining: 60, startMinute: 0 }));

  // Subtract existing assignments from any overlapping slot hour.
  for (const ea of existingAssignments) {
    const start = new Date(ea.startIso);
    const end = new Date(ea.endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    for (const st of slotState) {
      const slotStart = new Date(buildIso(dateIso, st.slot.hour, 0)).getTime();
      const slotEnd = slotStart + 60 * 60 * 1000;
      const overlapStart = Math.max(slotStart, start.getTime());
      const overlapEnd = Math.min(slotEnd, end.getTime());
      if (overlapEnd > overlapStart) {
        const overlapMinutes = Math.ceil((overlapEnd - overlapStart) / 60000);
        st.remaining = Math.max(0, st.remaining - overlapMinutes);
        // Push the writable-start forward if the overlap touches the top of the hour.
        if (overlapStart <= slotStart) {
          const consumed = Math.min(60, overlapMinutes);
          st.startMinute = Math.max(st.startMinute, consumed);
        }
      }
    }
  }

  // Stable task order: high → medium → low, then by input order.
  const orderedTasks = tasks
    .map((t, idx) => ({ task: t, idx }))
    .sort(
      (a, b) =>
        loadRank(a.task.cognitiveLoad) - loadRank(b.task.cognitiveLoad) ||
        a.idx - b.idx,
    )
    .map((x) => x.task);

  const assignments: SlotAssignment[] = [];
  for (const task of orderedTasks) {
    const preferred = loadToImportance(task.cognitiveLoad);
    const duration = Math.max(1, task.durationMinutes);

    // Candidate slots ranked by distance from preferred importance, then
    // (B-3) by energy weight desc — higher historical completion rate wins
    // among equally-matching importance — finally by hour ascending.
    const candidates = slotState
      .filter((st) => st.remaining > 0)
      .map((st) => ({
        st,
        distance: Math.abs(st.slot.importance - preferred),
        energy: energyWeightFor(hourEnergyWeights, st.slot.hour, task.category),
      }))
      .sort(
        (a, b) =>
          a.distance - b.distance ||
          b.energy - a.energy ||
          a.st.slot.hour - b.st.slot.hour,
      );

    let placed: { st: (typeof slotState)[number] } | null = null;
    for (const c of candidates) {
      if (c.st.remaining >= duration) {
        placed = { st: c.st };
        break;
      }
    }
    // No slot with enough room for the full duration — truncate into the best
    // available slot instead of dropping the task entirely.
    if (!placed && candidates.length > 0) placed = { st: candidates[0].st };
    if (!placed) continue;

    const startHour = placed.st.slot.hour;
    const startMin = placed.st.startMinute;
    const usable = Math.min(duration, placed.st.remaining);
    const endTotalMinutes = startHour * 60 + startMin + usable;
    const endHour = Math.floor(endTotalMinutes / 60);
    const endMin = endTotalMinutes % 60;

    assignments.push({
      taskId: task.id,
      startIso: buildIso(dateIso, startHour, startMin),
      endIso: buildIso(dateIso, endHour, endMin),
      slotImportance: placed.st.slot.importance,
    });

    placed.st.remaining -= usable;
    placed.st.startMinute += usable;
  }

  return assignments;
}
