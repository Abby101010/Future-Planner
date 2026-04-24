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
  weight?: "must" | "should" | "nice" | string;
  timeBlock?: string;
  tag?: string;
  projectTag?: string;
}

export interface UIReminder {
  id: string;
  title: string;
  date?: string;
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
