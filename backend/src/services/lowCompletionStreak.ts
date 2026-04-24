/* ──────────────────────────────────────────────────────────
   Starward — Low-Completion Streak (Initiative B Phase 1)

   Consumes the logsByDate structure already built inside
   cmdAdaptiveReschedule — no extra DB reads. Walks backward
   from `today`, counting consecutive days with ≤ 1 completion.

   The classifier treats a streak ≥ 14 as evidence the whole plan
   needs a rewrite, not a targeted patch.
   ────────────────────────────────────────────────────────── */

export interface CompletionLogEntry {
  date: string;
  tasks: Array<{ completed: boolean; skipped?: boolean }>;
}

function addDaysISO(iso: string, deltaDays: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().split("T")[0];
}

export function computeLowCompletionStreak(
  logs: CompletionLogEntry[],
  today: string,
): number {
  if (!logs || logs.length === 0) return 0;
  const byDate = new Map<string, CompletionLogEntry>();
  for (const entry of logs) byDate.set(entry.date, entry);

  let streak = 0;
  // Start from yesterday — today's partial-day completion doesn't belong
  // in a "consecutive past days with low output" measurement.
  for (let offset = 1; offset <= 60; offset++) {
    const date = addDaysISO(today, -offset);
    const entry = byDate.get(date);
    if (!entry) break;
    const completedCount = entry.tasks.filter((t) => t.completed).length;
    if (completedCount <= 1) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}
