/* NorthStar — monthly_contexts table */

import { getDB } from "./connection";

export interface DBMonthlyContext {
  month: string;
  description: string;
  intensity: string;
  intensity_reasoning: string;
  capacity_multiplier: number;
  max_daily_tasks: number;
  updated_at: string;
}

export async function getAllMonthlyContexts(): Promise<DBMonthlyContext[]> {
  const d = getDB();
  return d
    .prepare("SELECT * FROM monthly_contexts ORDER BY month DESC")
    .all() as DBMonthlyContext[];
}

export async function getMonthlyContext(
  month: string,
): Promise<DBMonthlyContext | null> {
  const d = getDB();
  const row = d
    .prepare("SELECT * FROM monthly_contexts WHERE month = ?")
    .get(month) as DBMonthlyContext | undefined;
  return row ?? null;
}

export async function upsertMonthlyContext(ctx: {
  month: string;
  description: string;
  intensity: string;
  intensityReasoning: string;
  capacityMultiplier: number;
  maxDailyTasks: number;
}): Promise<void> {
  const d = getDB();
  d.prepare(
    `INSERT INTO monthly_contexts (month, description, intensity, intensity_reasoning, capacity_multiplier, max_daily_tasks, updated_at)
     VALUES (?,?,?,?,?,?,datetime('now'))
     ON CONFLICT (month) DO UPDATE SET
       description=excluded.description, intensity=excluded.intensity,
       intensity_reasoning=excluded.intensity_reasoning,
       capacity_multiplier=excluded.capacity_multiplier,
       max_daily_tasks=excluded.max_daily_tasks,
       updated_at=datetime('now')`,
  ).run(
    ctx.month,
    ctx.description,
    ctx.intensity,
    ctx.intensityReasoning,
    ctx.capacityMultiplier,
    ctx.maxDailyTasks,
  );
}

export async function deleteMonthlyContext(month: string): Promise<void> {
  const d = getDB();
  d.prepare("DELETE FROM monthly_contexts WHERE month = ?").run(month);
}
