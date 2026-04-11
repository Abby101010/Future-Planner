/* ──────────────────────────────────────────────────────────
   NorthStar — Local API Server (cloud-ready)
   
   Express server that runs inside the Electron main process.
   Mirrors all IPC handlers as REST endpoints so the app can
   transition to a cloud backend with zero frontend changes.
   
   Current: localhost:3741 (Electron-embedded)
   Future:  https://api.northstar.app (cloud deployment)
   
   The renderer can be configured to use either IPC or HTTP
   by toggling a single flag.
   ────────────────────────────────────────────────────────── */

import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import type { Server } from "node:http";
import { handleAIRequest } from "./ai-handler";
import { getScheduleContext, summarizeScheduleForAI, listDeviceCalendars, getDeviceCalendarEvents } from "./calendar";
import { loadMemory, saveMemory, getMemorySummary } from "./memory";
import {
  captureSignal,
  captureSnooze,
  captureTaskTiming,
  captureExplicitFeedback,
  quickReflect,
  runReflection,
  generateNudges,
  shouldAutoReflect,
} from "./reflection";
import {
  loadAppData,
  saveAppData,
  getAllCalendarEvents,
  getCalendarEventsByRange,
  upsertCalendarEvent,
  deleteCalendarEvent,
  dbClearMemory,
} from "./database";

const API_PORT = parseInt(process.env.NORTHSTAR_API_PORT || "3741", 10);

let server: Server | null = null;
let _dbAvailable = false;

/** Set the DB availability flag (called from main.ts) */
export function setAPIDBAvailable(available: boolean): void {
  _dbAvailable = available;
}

// ── Helpers ─────────────────────────────────────────────

function loadDataSync(): Record<string, unknown> {
  // Reads from JSON for sync access (API key retrieval)
  const fs = require("node:fs");
  const path = require("node:path");
  const { app } = require("electron");
  const filePath = path.join(app.getPath("userData"), "northstar-data.json");
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch { /* empty */ }
  return {};
}

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

// ── Server Setup ────────────────────────────────────────

export function startAPIServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const app = express();

    app.use(cors({ origin: true }));
    app.use(express.json({ limit: "5mb" }));

    // ── Health ────────────────────────────────────────────
    app.get("/api/health", (_req, res) => {
      res.json({ ok: true, db: _dbAvailable, version: "0.1.0" });
    });

    // ── Store ─────────────────────────────────────────────
    app.get("/api/store", wrap(async (_req, res) => {
      const data = _dbAvailable ? await loadAppData() : loadDataSync();
      res.json(data);
    }));

    app.put("/api/store", wrap(async (req, res) => {
      const data = req.body as Record<string, unknown>;
      if (_dbAvailable) await saveAppData(data);
      res.json({ ok: true });
    }));

    // ── AI Endpoints ──────────────────────────────────────
    const aiRoutes: string[] = [
      "onboarding", "goal-breakdown", "reallocate",
      "daily-tasks", "recovery", "pace-check",
    ];
    for (const route of aiRoutes) {
      app.post(`/api/ai/${route}`, wrap(async (req, res) => {
        const result = await handleAIRequest(
          route as Parameters<typeof handleAIRequest>[0],
          req.body,
          loadDataSync
        );
        res.json(result);
      }));
    }

    // ── Calendar ──────────────────────────────────────────
    app.get("/api/calendar/events", wrap(async (req, res) => {
      if (!_dbAvailable) {
        res.json({ ok: false, error: "Database not available", events: [] });
        return;
      }
      const { startDate, endDate } = req.query;
      const events = startDate && endDate
        ? await getCalendarEventsByRange(startDate as string, endDate as string)
        : await getAllCalendarEvents();
      res.json({ ok: true, events });
    }));

    app.post("/api/calendar/events", wrap(async (req, res) => {
      if (!_dbAvailable) { res.json({ ok: false, error: "Database not available" }); return; }
      await upsertCalendarEvent(req.body);
      res.json({ ok: true });
    }));

    app.delete("/api/calendar/events/:id", wrap(async (req, res) => {
      if (!_dbAvailable) { res.json({ ok: false, error: "Database not available" }); return; }
      await deleteCalendarEvent(req.params.id as string);
      res.json({ ok: true });
    }));

    app.post("/api/calendar/schedule", wrap(async (req, res) => {
      const { startDate, endDate, deviceIntegrations } = req.body;
      let inAppEvents = req.body.inAppEvents || [];
      if (_dbAvailable) {
        try {
          const dbEvents = await getCalendarEventsByRange(startDate, endDate);
          inAppEvents = dbEvents.map((e) => ({
            id: e.id,
            title: e.title,
            startDate: e.start_date,
            endDate: e.end_date,
            isAllDay: e.is_all_day,
            durationMinutes: e.duration_minutes,
            isVacation: e.is_vacation,
            source: e.source,
          }));
        } catch { /* fallback to payload */ }
      }
      const ctx = await getScheduleContext(startDate, endDate, inAppEvents, deviceIntegrations);
      res.json({ ok: true, data: ctx, summary: summarizeScheduleForAI(ctx) });
    }));

    app.get("/api/device/calendars", wrap(async (_req, res) => {
      try {
        const calendars = await listDeviceCalendars();
        res.json({ ok: true, calendars });
      } catch (err) {
        res.json({ ok: false, error: String(err), calendars: [] });
      }
    }));

    app.post("/api/device/import-events", wrap(async (req, res) => {
      try {
        const { startDate, endDate, selectedCalendars } = req.body;
        const events = await getDeviceCalendarEvents(startDate, endDate, selectedCalendars || []);
        res.json({ ok: true, events });
      } catch (err) {
        res.json({ ok: false, error: String(err), events: [] });
      }
    }));

    // ── Memory ────────────────────────────────────────────
    app.get("/api/memory/summary", (_req, res) => {
      try {
        const memory = loadMemory();
        res.json({ ok: true, data: getMemorySummary(memory) });
      } catch (err) {
        res.json({ ok: false, error: String(err) });
      }
    });

    app.get("/api/memory", (_req, res) => {
      try {
        res.json({ ok: true, data: loadMemory() });
      } catch (err) {
        res.json({ ok: false, error: String(err) });
      }
    });

    app.delete("/api/memory", wrap(async (_req, res) => {
      saveMemory({
        facts: [], preferences: [], signals: [],
        snoozeRecords: [], taskTimings: [],
        lastReflectionAt: null, reflectionCount: 0, version: 1,
      });
      if (_dbAvailable) await dbClearMemory().catch(() => {});
      res.json({ ok: true });
    }));

    app.post("/api/memory/signal", (_req, res) => {
      try {
        const { type, context, value } = _req.body;
        captureSignal(type, context, value);
        res.json({ ok: true });
      } catch (err) {
        res.json({ ok: false, error: String(err) });
      }
    });

    app.post("/api/memory/task-completed", (_req, res) => {
      try {
        const { taskTitle, taskCategory, actualMinutes, estimatedMinutes } = _req.body;
        quickReflect("task_completed", { taskTitle, taskCategory, completionTime: actualMinutes, estimatedTime: estimatedMinutes });
        res.json({ ok: true });
      } catch (err) {
        res.json({ ok: false, error: String(err) });
      }
    });

    app.post("/api/memory/task-snoozed", (_req, res) => {
      try {
        const { taskTitle, taskCategory, date } = _req.body;
        captureSnooze(taskTitle, taskCategory, date);
        res.json({ ok: true });
      } catch (err) {
        res.json({ ok: false, error: String(err) });
      }
    });

    app.post("/api/memory/task-skipped", (_req, res) => {
      try {
        const { taskTitle, taskCategory, date } = _req.body;
        quickReflect("task_skipped", { taskTitle, taskCategory, date });
        res.json({ ok: true });
      } catch (err) {
        res.json({ ok: false, error: String(err) });
      }
    });

    app.post("/api/memory/feedback", (_req, res) => {
      try {
        const { context, feedback, isPositive } = _req.body;
        captureExplicitFeedback(context, feedback, isPositive);
        res.json({ ok: true });
      } catch (err) {
        res.json({ ok: false, error: String(err) });
      }
    });

    app.post("/api/memory/reflect", wrap(async (req, res) => {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      let apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        const data = loadDataSync();
        const user = data.user as Record<string, unknown> | undefined;
        const settings = user?.settings as Record<string, unknown> | undefined;
        apiKey = settings?.apiKey as string | undefined;
      }
      if (!apiKey) { res.json({ ok: false, error: "No API key" }); return; }

      const client = new Anthropic({ apiKey });
      const result = await runReflection(client, req.body?.trigger || "manual");
      res.json({ ok: true, data: result });
    }));

    app.post("/api/memory/task-timing", (_req, res) => {
      try {
        const { taskCategory, taskTitle, estimatedMinutes, actualMinutes } = _req.body;
        captureTaskTiming(taskCategory, taskTitle, estimatedMinutes, actualMinutes);
        res.json({ ok: true });
      } catch (err) {
        res.json({ ok: false, error: String(err) });
      }
    });

    // ── Nudges ────────────────────────────────────────────
    app.post("/api/memory/nudges", (_req, res) => {
      try {
        const { tasks, proactiveQuestion } = _req.body;
        const nudges = generateNudges(tasks || [], proactiveQuestion);
        res.json({ ok: true, data: nudges });
      } catch (err) {
        res.json({ ok: false, error: String(err), data: [] });
      }
    });

    app.get("/api/memory/should-reflect", (_req, res) => {
      try {
        res.json({ ok: true, shouldReflect: shouldAutoReflect() });
      } catch (err) {
        res.json({ ok: false, shouldReflect: false, error: String(err) });
      }
    });

    // ── Error handler ─────────────────────────────────────
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      console.error("[API] Error:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    });

    server = app.listen(API_PORT, "127.0.0.1", () => {
      console.log(`[API] NorthStar API server on http://127.0.0.1:${API_PORT}`);
      resolve(API_PORT);
    });

    server.on("error", (err) => {
      console.error("[API] Failed to start:", err);
      reject(err);
    });
  });
}

export function stopAPIServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        server = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}
