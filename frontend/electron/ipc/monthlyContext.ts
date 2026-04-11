/* NorthStar — monthly-context IPC handlers */

import { ipcMain } from "electron";
import {
  getAllMonthlyContexts,
  getMonthlyContext,
  upsertMonthlyContext,
  deleteMonthlyContext,
} from "../database";
import { handleAIRequest } from "../ai-handler";
import type { AgentProgressEvent } from "../agents/types";
import { getIpcContext } from "./context";

export function registerMonthlyContextIpc(): void {
  const ctx = getIpcContext();

  ipcMain.handle("monthly-context:list", async () => {
    try {
      if (!ctx.isDbAvailable()) return { ok: true, contexts: [] };
      const rows = await getAllMonthlyContexts();
      const contexts = rows.map((r) => ({
        month: r.month,
        description: r.description,
        intensity: r.intensity,
        intensityReasoning: r.intensity_reasoning,
        capacityMultiplier: r.capacity_multiplier,
        maxDailyTasks: r.max_daily_tasks,
        updatedAt: r.updated_at,
      }));
      return { ok: true, contexts };
    } catch (err) {
      return { ok: false, error: String(err), contexts: [] };
    }
  });

  ipcMain.handle(
    "monthly-context:get",
    async (_event, payload: { month: string }) => {
      try {
        if (!ctx.isDbAvailable()) return { ok: false, context: null };
        const row = await getMonthlyContext(payload.month);
        if (!row) return { ok: true, context: null };
        return {
          ok: true,
          context: {
            month: row.month,
            description: row.description,
            intensity: row.intensity,
            intensityReasoning: row.intensity_reasoning,
            capacityMultiplier: row.capacity_multiplier,
            maxDailyTasks: row.max_daily_tasks,
            updatedAt: row.updated_at,
          },
        };
      } catch (err) {
        return { ok: false, error: String(err), context: null };
      }
    },
  );

  ipcMain.handle("monthly-context:upsert", async (_event, payload) => {
    try {
      if (!ctx.isDbAvailable()) return { ok: true }; // persisted via JSON fallback
      await upsertMonthlyContext(payload);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(
    "monthly-context:delete",
    async (_event, payload: { month: string }) => {
      try {
        if (!ctx.isDbAvailable()) return { ok: true };
        await deleteMonthlyContext(payload.month);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );

  // AI-powered monthly context analysis
  ipcMain.handle(
    "monthly-context:analyze",
    async (_event, payload: { month: string; description: string }) => {
      try {
        const progressCb = (evt: AgentProgressEvent) => {
          ctx.getMainWindow()?.webContents.send("agent:progress", evt);
        };
        return handleAIRequest(
          "analyze-monthly-context",
          {
            month: payload.month,
            description: payload.description,
          },
          ctx.loadDataSync,
          progressCb,
        );
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  );
}
