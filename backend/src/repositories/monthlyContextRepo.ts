/* Starward server — monthly context repository
 *
 * Thin wrapper around the legacy `monthly_contexts` table. SQL is lifted
 * verbatim from packages/server/src/routes/monthlyContext.ts so that once
 * routes are cut over in Task 13/14, behavior is byte-identical.
 */

import type { MonthlyContext } from "@starward/core";
import { query } from "../db/pool";
import { requireUserId } from "./_context";

interface MonthlyContextRow {
  month: string;
  description: string;
  intensity: string;
  intensity_reasoning: string;
  capacity_multiplier: number;
  max_daily_tasks: number;
  updated_at: string;
}

function rowToContext(r: MonthlyContextRow): MonthlyContext {
  return {
    month: r.month,
    description: r.description,
    intensity: r.intensity as MonthlyContext["intensity"],
    intensityReasoning: r.intensity_reasoning,
    capacityMultiplier: Number(r.capacity_multiplier),
    maxDailyTasks: r.max_daily_tasks,
    updatedAt: r.updated_at,
  };
}

export async function list(): Promise<MonthlyContext[]> {
  const userId = requireUserId();
  const rows = await query<MonthlyContextRow>(
    `select * from monthly_contexts where user_id = $1 order by month desc`,
    [userId],
  );
  return rows.map(rowToContext);
}

export async function get(month: string): Promise<MonthlyContext | null> {
  const userId = requireUserId();
  const rows = await query<MonthlyContextRow>(
    `select * from monthly_contexts where user_id = $1 and month = $2`,
    [userId, month],
  );
  return rows.length > 0 ? rowToContext(rows[0]) : null;
}

export async function upsert(context: MonthlyContext): Promise<void> {
  const userId = requireUserId();
  await query(
    `insert into monthly_contexts (
       user_id, month, description, intensity, intensity_reasoning,
       capacity_multiplier, max_daily_tasks, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, now())
     on conflict (user_id, month) do update set
       description = excluded.description,
       intensity = excluded.intensity,
       intensity_reasoning = excluded.intensity_reasoning,
       capacity_multiplier = excluded.capacity_multiplier,
       max_daily_tasks = excluded.max_daily_tasks,
       updated_at = now()`,
    [
      userId,
      context.month,
      context.description ?? "",
      context.intensity ?? "normal",
      context.intensityReasoning ?? "",
      typeof context.capacityMultiplier === "number"
        ? context.capacityMultiplier
        : 1.0,
      typeof context.maxDailyTasks === "number" ? context.maxDailyTasks : 4,
    ],
  );
}

export async function remove(month: string): Promise<void> {
  const userId = requireUserId();
  await query(
    `delete from monthly_contexts where user_id = $1 and month = $2`,
    [userId, month],
  );
}

export { remove as delete_ };
