/* Starward server — database helpers re-exported for AI handlers
 *
 * The electron version of this module wraps better-sqlite3 reads for a
 * handful of tables the AI handlers query directly (without going through
 * the IPC layer). The server version queries Postgres instead.
 *
 * The exported types and signatures intentionally MIRROR
 * electron/db/monthlyContext.ts so the copied AI handlers compile unchanged.
 *
 * IMPORTANT: getMonthlyContext takes no user_id — it matches the electron
 * signature. In phase 1 it always returns null (the dailyTasks handler treats
 * "no monthly context" as the default branch). Phase 1b will thread request
 * context through so this can return real per-user rows.
 */

/** Mirrors electron/db/monthlyContext.ts DBMonthlyContext exactly. */
export interface DBMonthlyContext {
  month: string;
  description: string;
  intensity: string;
  intensity_reasoning: string;
  capacity_multiplier: number;
  max_daily_tasks: number;
  updated_at: string;
}

/**
 * Phase 1 stub: always returns null. Handlers handle this as "user hasn't
 * set monthly context for this month" and fall through to capacity defaults.
 *
 * TODO(phase 1b): thread request context through the handler chain so this
 * can return the real per-user Postgres row.
 */
export async function getMonthlyContext(
  _month: string,
): Promise<DBMonthlyContext | null> {
  return null;
}
