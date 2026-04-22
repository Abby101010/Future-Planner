/* NorthStar server — monthly-context routes
 *
 * HTTP mirror of electron/ipc/monthlyContext.ts. Scoped by req.userId.
 * The "analyze" endpoint proxies to the AI handler chain (analyze-monthly-context).
 */

import { Router } from "express";
import { query } from "../db/pool";
import { asyncHandler } from "../middleware/errorHandler";
import { handleAIRequest } from "../ai/router";

export const monthlyContextRouter = Router();

interface MonthlyContextRow {
  month: string;
  description: string;
  intensity: string;
  intensity_reasoning: string;
  capacity_multiplier: number;
  max_daily_tasks: number;
  updated_at: string;
}

function rowToContext(r: MonthlyContextRow) {
  return {
    month: r.month,
    description: r.description,
    intensity: r.intensity,
    intensityReasoning: r.intensity_reasoning,
    capacityMultiplier: Number(r.capacity_multiplier),
    maxDailyTasks: r.max_daily_tasks,
    updatedAt: r.updated_at,
  };
}

// POST /monthly-context/list
monthlyContextRouter.post(
  "/list",
  asyncHandler(async (req, res) => {
    const rows = await query<MonthlyContextRow>(
      `select * from monthly_contexts where user_id = $1 order by month desc`,
      [req.userId],
    );
    res.json({ ok: true, contexts: rows.map(rowToContext) });
  }),
);

// POST /monthly-context/get
monthlyContextRouter.post(
  "/get",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as { month?: string };
    if (!p.month) {
      res.status(400).json({ ok: false, error: "missing month" });
      return;
    }
    const rows = await query<MonthlyContextRow>(
      `select * from monthly_contexts where user_id = $1 and month = $2`,
      [req.userId, p.month],
    );
    if (rows.length === 0) {
      res.json({ ok: true, context: null });
      return;
    }
    res.json({ ok: true, context: rowToContext(rows[0]) });
  }),
);

// POST /monthly-context/upsert
monthlyContextRouter.post(
  "/upsert",
  asyncHandler(async (req, res) => {
    const c = (req.body ?? {}) as Record<string, unknown>;
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
        req.userId,
        String(c.month ?? ""),
        String(c.description ?? ""),
        String(c.intensity ?? "normal"),
        String(c.intensityReasoning ?? ""),
        typeof c.capacityMultiplier === "number" ? c.capacityMultiplier : 1.0,
        typeof c.maxDailyTasks === "number" ? c.maxDailyTasks : 4,
      ],
    );
    res.json({ ok: true });
  }),
);

// POST /monthly-context/delete
monthlyContextRouter.post(
  "/delete",
  asyncHandler(async (req, res) => {
    const p = (req.body ?? {}) as { month?: string };
    if (!p.month) {
      res.status(400).json({ ok: false, error: "missing month" });
      return;
    }
    await query(
      "delete from monthly_contexts where user_id = $1 and month = $2",
      [req.userId, p.month],
    );
    res.json({ ok: true });
  }),
);

// POST /monthly-context/analyze — AI-powered intensity classification
monthlyContextRouter.post(
  "/analyze",
  asyncHandler(async (_req, res) => {
    const p = (_req.body ?? {}) as { month?: string; description?: string };
    const result = await handleAIRequest("analyze-monthly-context", {
      month: p.month,
      description: p.description,
    });
    res.json(result);
  }),
);
