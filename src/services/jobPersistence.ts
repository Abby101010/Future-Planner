/* ──────────────────────────────────────────────────────────
   NorthStar — Job persistence helpers

   Single source of truth for the `planJobId:${goalId}` localStorage
   key that lets GoalPlanPage's progress display reattach to a
   running plan-generation job across navigation and re-mounts.

   No UI/page should call localStorage directly for this purpose;
   import these helpers instead.
   ────────────────────────────────────────────────────────── */

const KEY_PREFIX = "planJobId:";

function key(goalId: string): string {
  return `${KEY_PREFIX}${goalId}`;
}

export function getPlanJobId(goalId: string): string | null {
  try {
    return localStorage.getItem(key(goalId));
  } catch {
    return null;
  }
}

export function setPlanJobId(goalId: string, jobId: string): void {
  try {
    localStorage.setItem(key(goalId), jobId);
  } catch {
    /* quota or unavailable — silent */
  }
}

export function clearPlanJobId(goalId: string): void {
  try {
    localStorage.removeItem(key(goalId));
  } catch {
    /* silent */
  }
}

export function hasPlanJobId(goalId: string): boolean {
  return !!getPlanJobId(goalId);
}
