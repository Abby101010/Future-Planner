/* Shared UI shapes for the Tasks page and its sub-components.
 * Superset of what view:tasks / view:dashboard actually return — unknown
 * fields are optional. */

export interface UITask {
  id: string;
  title: string;
  goal?: string;
  goalTitle?: string;
  duration?: number;
  estimatedDurationMinutes?: number;
  /** Cognitive-load classification — drives the warm-voice pill on
   *  TaskRow / DayBlock and the energy-window routing in
   *  services/cognitiveLoadScheduler.ts. Sourced from
   *  daily_tasks.cognitive_load (Phase B columns, migration 0011).
   *  Optional because pre-Phase-B rows + manually-added tasks may
   *  not be classified yet. */
  cognitiveLoad?: "high" | "medium" | "low";
  /** 1–10 score; daily aggregate vs. user's effective cognitive
   *  budget. */
  cognitiveCost?: number;
  /** Time-of-day affinity. fresh-focus = peak window only.
   *  creative = flow-state. depleted-ok = late evening fine. */
  energyType?: "fresh-focus" | "creative" | "depleted-ok";
  scheduled?: string;
  scheduledStartIso?: string;
  done?: boolean;
  completed?: boolean;
  /** Set when the user clicked "skip" — the task remains in `tasks[]`
   *  but is off the active list. Treat skipped == not visible in
   *  today's active rendering (mirrors backend tasksView.ts:354). */
  skipped?: boolean;
  /** "must-do" / "should-do" / "bonus" — the AI-assigned priority.
   *  Bonus tasks are hidden from the active list (cognitive-budget
   *  cap demotes excess to bonus). Mirrors backend tasksView.ts:354
   *  `!isBonusTask(t)` filter. */
  priority?: string;
  /** Explicit bonus flag set by the triage demote pass and by
   *  cmdGenerateBonusTask. Either this OR priority="bonus" hides the
   *  task from the active list. */
  isBonus?: boolean;
  weight?: "must" | "should" | "nice" | string;
  timeBlock?: string;
  tag?: string;
  projectTag?: string;
}

/** Repeat schedule for a reminder. Mirrors the canonical enum on
 *  `backend/core/src/types/index.ts:Reminder.repeat`; null = one-time. */
export type UIReminderRepeat = "daily" | "weekly" | "monthly" | null;

export interface UIReminder {
  id: string;
  title: string;
  date?: string;
  /** ISO datetime (e.g. "2026-04-27T09:00:00"). Mirrors
   *  `Reminder.reminderTime` on the BE Reminder shape. Surfaced here so
   *  the inline editor in ReminderRow can preserve the original
   *  time-of-day across edits instead of resetting to 09:00 each save. */
  reminderTime?: string;
  /** Repeat cadence. Sourced from `Reminder.repeat` server-side; the
   *  manual add UI exposes the same enum. */
  repeat?: UIReminderRepeat;
  /** UI-only. Set client-side when the reminder comes from the view's
   *  `overdueReminders` slice. The backend never emits this field. */
  overdue?: boolean;
}

export interface UIPendingTask {
  id: string;
  userInput?: string;
  title?: string;
}

export interface UIProposal {
  id: string;
  title?: string;
  reason?: string;
}

/** A task from a past day that the user hasn't decided what to do with.
 *  Mirrors backend `PendingReschedule` (tasksView.ts:62) so that the
 *  pendingReschedules array the backend already computes is finally
 *  surfaced in the FE — previously the page read a `proposals` field
 *  that no view populated. */
export interface UIPendingReschedule {
  taskId: string;
  title: string;
  originalDate: string;
  daysOverdue: number;
  agedOut: boolean;
  goalTitle?: string;
  suggestedDate: string;
  suggestedDateLabel: string;
}

export interface UINudge {
  id: string;
  text: string;
  kind?: string;
}
