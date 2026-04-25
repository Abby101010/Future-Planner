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

export interface UIReminder {
  id: string;
  title: string;
  date?: string;
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

export interface UINudge {
  id: string;
  text: string;
  kind?: string;
}
