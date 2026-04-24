/* Shared UI types for the Planning / Goal Plan pages.
 * These are local shapes that may be a superset of what view:planning
 * currently returns; anything missing falls back to sensible defaults. */

import type { Pace } from "./PaceBadge";

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
}
