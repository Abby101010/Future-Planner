/* Shared UI types for the Planning / Goal Plan pages.
 * These are local shapes that may be a superset of what view:planning
 * currently returns; anything missing falls back to sensible defaults. */

import type { Pace } from "./PaceBadge";

/** In-flight `regenerate-goal-plan` job descriptor surfaced on each goal
 *  by the `view:planning` resolver (see
 *  backend/src/views/planningView.ts). Null when no plan job is queued
 *  or running for this goal. When present, the goal card renders a
 *  "Planning…" pill in place of the pace badge. */
export interface PlanningInFlightDescriptor {
  jobId: string;
  status: "pending" | "running";
  startedAt: string;
}

export interface PlanningGoal {
  id: string;
  title: string;
  status: "active" | "paused" | "archived" | "completed" | string;
  description?: string;
  horizon?: string;
  icon?: string;
  pct?: number;
  nextMilestone?: string;
  nextDue?: string | null;
  pace: Pace;
  paceDelta?: string;
  tasksThisWeek?: number;
  openTasks?: number;
  /** Populated by `view:planning`; null when no plan job is in flight. */
  inFlight?: PlanningInFlightDescriptor | null;
}
