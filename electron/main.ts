/* ──────────────────────────────────────────────────────────
   NorthStar — Electron main process
   ────────────────────────────────────────────────────────── */

import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs";
import { handleAIRequest } from "./ai-handler";
import { getScheduleContext, summarizeScheduleForAI, listDeviceCalendars, getDeviceCalendarEvents } from "./calendar";
import { loadMemory, saveMemory, getMemorySummary, ensureManagerReady, getBehaviorProfile, saveBehaviorProfile } from "./memory";
import {
  captureSignal,
  captureSnooze,
  captureTaskTiming,
  captureSessionStart,
  captureExplicitFeedback,
  quickReflect,
  runReflection,
  generateNudges,
  shouldAutoReflect,
} from "./reflection";
import {
  testConnection,
  runMigrations,
  closePool,
  loadAppData,
  saveAppData,
  getAllCalendarEvents,
  getCalendarEventsByRange,
  upsertCalendarEvent,
  deleteCalendarEvent,
  dbClearMemory,
  ensureVectorColumn,
  backfillPreferenceEmbeddings,
} from "./database";
import { startAPIServer, stopAPIServer, setAPIDBAvailable } from "./api-server";
import { coordinateNewsBriefing } from "./agents/coordinator";
import { initAutoUpdater } from "./auto-updater";
import type { AgentProgressEvent, NewsBriefing } from "./agents/types";

// Load .env file in development
const envPath = path.join(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && !process.env[key]) process.env[key] = value;
  }
}

// The built directory structure:
//   ├── dist/              (Vite build output — renderer)
//   ├── dist-electron/     (Electron main & preload compiled output)

process.env.DIST = path.join(__dirname, "../dist");
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, "../public");

let mainWindow: BrowserWindow | null = null;

const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];

// ── Data persistence (PostgreSQL-backed, JSON fallback) ─
const userDataPath = app.getPath("userData");
const dataFilePath = path.join(userDataPath, "northstar-data.json");

let _dbAvailable = false;

function loadDataFromJSON(): Record<string, unknown> {
  try {
    if (fs.existsSync(dataFilePath)) {
      return JSON.parse(fs.readFileSync(dataFilePath, "utf-8"));
    }
  } catch (err) {
    console.error("Failed to load JSON data:", err);
  }
  return {};
}

function saveDataToJSON(data: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(dataFilePath), { recursive: true });
    fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to save JSON data:", err);
  }
}

async function loadData(): Promise<Record<string, unknown>> {
  if (_dbAvailable) {
    try {
      return await loadAppData();
    } catch (err) {
      console.warn("[DB] loadAppData failed, using JSON:", err);
    }
  }
  return loadDataFromJSON();
}

async function saveData(data: Record<string, unknown>): Promise<void> {
  // Always save to JSON as fallback
  saveDataToJSON(data);
  // Also save to DB if available
  if (_dbAvailable) {
    try {
      await saveAppData(data);
    } catch (err) {
      console.warn("[DB] saveAppData failed:", err);
    }
  }
}

// Sync wrapper for places that need it (e.g. getClient in ai-handler)
function loadDataSync(): Record<string, unknown> {
  return loadDataFromJSON();
}

// ── IPC Handlers ────────────────────────────────────────

function setupIPC() {
  ipcMain.handle("store:load", async () => {
    return loadData();
  });

  ipcMain.handle("store:save", async (_event, data: Record<string, unknown>) => {
    await saveData(data);
    return { ok: true };
  });

  ipcMain.handle("ai:onboarding", async (_event, payload) => {
    const progressCb = (evt: AgentProgressEvent) => {
      mainWindow?.webContents.send("agent:progress", evt);
    };
    return handleAIRequest("onboarding", payload, loadDataSync, progressCb);
  });

  ipcMain.handle("ai:goal-breakdown", async (_event, payload) => {
    const progressCb = (evt: AgentProgressEvent) => {
      mainWindow?.webContents.send("agent:progress", evt);
    };
    return handleAIRequest("goal-breakdown", payload, loadDataSync, progressCb);
  });

  ipcMain.handle("ai:reallocate", async (_event, payload) => {
    const progressCb = (evt: AgentProgressEvent) => {
      mainWindow?.webContents.send("agent:progress", evt);
    };
    return handleAIRequest("reallocate", payload, loadDataSync, progressCb);
  });

  ipcMain.handle("ai:daily-tasks", async (_event, payload) => {
    const progressCb = (evt: AgentProgressEvent) => {
      mainWindow?.webContents.send("agent:progress", evt);
    };
    return handleAIRequest("daily-tasks", payload, loadDataSync, progressCb);
  });

  ipcMain.handle("ai:recovery", async (_event, payload) => {
    const progressCb = (evt: AgentProgressEvent) => {
      mainWindow?.webContents.send("agent:progress", evt);
    };
    return handleAIRequest("recovery", payload, loadDataSync, progressCb);
  });

  ipcMain.handle("ai:pace-check", async (_event, payload) => {
    const progressCb = (evt: AgentProgressEvent) => {
      mainWindow?.webContents.send("agent:progress", evt);
    };
    return handleAIRequest("pace-check", payload, loadDataSync, progressCb);
  });

  ipcMain.handle("ai:classify-goal", async (_event, payload) => {
    const progressCb = (evt: AgentProgressEvent) => {
      mainWindow?.webContents.send("agent:progress", evt);
    };
    return handleAIRequest("classify-goal", payload, loadDataSync, progressCb);
  });

  ipcMain.handle("ai:goal-plan-chat", async (_event, payload) => {
    const progressCb = (evt: AgentProgressEvent) => {
      mainWindow?.webContents.send("agent:progress", evt);
    };
    return handleAIRequest("goal-plan-chat", payload, loadDataSync, progressCb);
  });

  ipcMain.handle("ai:generate-goal-plan", async (_event, payload) => {
    const progressCb = (evt: AgentProgressEvent) => {
      mainWindow?.webContents.send("agent:progress", evt);
    };
    return handleAIRequest("generate-goal-plan", payload, loadDataSync, progressCb);
  });

  ipcMain.handle("ai:goal-plan-edit", async (_event, payload) => {
    const progressCb = (evt: AgentProgressEvent) => {
      mainWindow?.webContents.send("agent:progress", evt);
    };
    return handleAIRequest("goal-plan-edit", payload, loadDataSync, progressCb);
  });

  ipcMain.handle("ai:analyze-quick-task", async (_event, payload) => {
    const progressCb = (evt: AgentProgressEvent) => {
      mainWindow?.webContents.send("agent:progress", evt);
    };
    return handleAIRequest("analyze-quick-task", payload, loadDataSync, progressCb);
  });

  ipcMain.handle("ai:home-chat", async (_event, payload) => {
    const progressCb = (evt: AgentProgressEvent) => {
      mainWindow?.webContents.send("agent:progress", evt);
    };
    return handleAIRequest("home-chat", payload, loadDataSync, progressCb);
  });

  // ── News Briefing (agent-powered) ───────────────────────

  ipcMain.handle("ai:news-briefing", async (_event, payload) => {
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      let apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        const data = loadDataSync();
        const user = data.user as Record<string, unknown> | undefined;
        const settings = user?.settings as Record<string, unknown> | undefined;
        apiKey = settings?.apiKey as string | undefined;
      }
      if (!apiKey) return { ok: false, error: "No API key" };

      const client = new Anthropic({ apiKey });
      const goalTitles = (payload?.goalTitles || []) as string[];
      const userInterests = (payload?.userInterests || []) as string[];
      const progressCb = (evt: AgentProgressEvent) => {
        mainWindow?.webContents.send("agent:progress", evt);
      };
      const result = await coordinateNewsBriefing(client, goalTitles, userInterests, progressCb);
      return { ok: result.success, data: result.data };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Calendar — build schedule from DB events + optional device data
  ipcMain.handle("calendar:schedule", async (_event, payload) => {
    try {
      const startDate = payload.startDate as string;
      const endDate = payload.endDate as string;
      const deviceIntegrations = payload.deviceIntegrations || undefined;

      // Read in-app events from DB (fallback to payload if DB unavailable)
      let inAppEvents = payload.inAppEvents || [];
      if (_dbAvailable) {
        try {
          const dbEvents = await getCalendarEventsByRange(startDate, endDate);
          inAppEvents = dbEvents.map((e: { id: string; title: string; start_date: string; end_date: string; is_all_day: boolean | number; duration_minutes: number; is_vacation: boolean | number; source: string }) => ({
            id: e.id,
            title: e.title,
            startDate: e.start_date,
            endDate: e.end_date,
            isAllDay: e.is_all_day,
            durationMinutes: e.duration_minutes,
            isVacation: e.is_vacation,
            source: e.source,
          }));
        } catch (err) {
          console.warn("[DB] Calendar events read failed, using payload:", err);
        }
      }

      const ctx = await getScheduleContext(startDate, endDate, inAppEvents, deviceIntegrations);
      return { ok: true, data: ctx, summary: summarizeScheduleForAI(ctx) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Device integration — list available calendars
  ipcMain.handle("device:list-calendars", async () => {
    try {
      const calendars = await listDeviceCalendars();
      return { ok: true, calendars };
    } catch (err) {
      return { ok: false, error: String(err), calendars: [] };
    }
  });

  // Device integration — import events from device calendar
  ipcMain.handle("device:import-calendar-events", async (_event, payload) => {
    try {
      const startDate = payload.startDate as string;
      const endDate = payload.endDate as string;
      const selectedCalendars = (payload.selectedCalendars || []) as string[];
      const events = await getDeviceCalendarEvents(startDate, endDate, selectedCalendars);
      return { ok: true, events };
    } catch (err) {
      return { ok: false, error: String(err), events: [] };
    }
  });

  // ── Calendar CRUD (PostgreSQL-backed) ─────────────────

  // List all calendar events (or by date range)
  ipcMain.handle("calendar:list-events", async (_event, payload) => {
    try {
      if (!_dbAvailable) return { ok: false, error: "Database not available", events: [] };
      const events = payload?.startDate && payload?.endDate
        ? await getCalendarEventsByRange(payload.startDate, payload.endDate)
        : await getAllCalendarEvents();
      return { ok: true, events };
    } catch (err) {
      return { ok: false, error: String(err), events: [] };
    }
  });

  // Create or update a calendar event
  ipcMain.handle("calendar:upsert-event", async (_event, payload) => {
    try {
      if (!_dbAvailable) return { ok: false, error: "Database not available" };
      await upsertCalendarEvent(payload);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Delete a calendar event
  ipcMain.handle("calendar:delete-event", async (_event, payload) => {
    try {
      if (!_dbAvailable) return { ok: false, error: "Database not available" };
      await deleteCalendarEvent(payload.id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── Memory System IPC ──────────────────────────────────

  // Get memory summary for UI display
  ipcMain.handle("memory:summary", () => {
    try {
      const memory = loadMemory();
      return { ok: true, data: getMemorySummary(memory) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Get full memory (for settings / debug)
  ipcMain.handle("memory:load", () => {
    try {
      return { ok: true, data: loadMemory() };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Clear all memory (reset)
  ipcMain.handle("memory:clear", async () => {
    try {
      saveMemory({
        facts: [],
        preferences: [],
        signals: [],
        snoozeRecords: [],
        taskTimings: [],
        lastReflectionAt: null,
        reflectionCount: 0,
        version: 1,
      });
      if (_dbAvailable) {
        await dbClearMemory().catch((err: unknown) =>
          console.warn("[DB] Failed to clear memory in DB:", err)
        );
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Record a behavioral signal from the renderer
  ipcMain.handle("memory:signal", (_event, payload) => {
    try {
      captureSignal(payload.type, payload.context, payload.value);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Record task completion with timing
  ipcMain.handle("memory:task-completed", (_event, payload) => {
    try {
      quickReflect("task_completed", {
        taskTitle: payload.taskTitle,
        taskCategory: payload.taskCategory,
        completionTime: payload.actualMinutes,
        estimatedTime: payload.estimatedMinutes,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Record task snooze
  ipcMain.handle("memory:task-snoozed", (_event, payload) => {
    try {
      captureSnooze(payload.taskTitle, payload.taskCategory, payload.date);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Record task skip
  ipcMain.handle("memory:task-skipped", (_event, payload) => {
    try {
      quickReflect("task_skipped", {
        taskTitle: payload.taskTitle,
        taskCategory: payload.taskCategory,
        date: payload.date,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Explicit user feedback
  ipcMain.handle("memory:feedback", (_event, payload) => {
    try {
      captureExplicitFeedback(payload.context, payload.feedback, payload.isPositive);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Trigger a full reflection (AI-powered analysis)
  ipcMain.handle("memory:reflect", async (_event, payload) => {
    try {
      // Need an API client for reflection
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      let apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        const data = loadDataSync();
        const user = data.user as Record<string, unknown> | undefined;
        const settings = user?.settings as Record<string, unknown> | undefined;
        apiKey = settings?.apiKey as string | undefined;
      }
      if (!apiKey) return { ok: false, error: "No API key" };

      const client = new Anthropic({ apiKey });
      const result = await runReflection(client, payload?.trigger || "manual");
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // ── Contextual Nudge Engine IPC ────────────────────────

  // Generate contextual nudges based on today's task state
  ipcMain.handle("memory:nudges", (_event, payload) => {
    try {
      const tasks = (payload?.tasks || []) as Array<{
        id: string;
        title: string;
        category: string;
        durationMinutes: number;
        completed: boolean;
        completedAt?: string;
        startedAt?: string;
        actualMinutes?: number;
        snoozedCount?: number;
        skipped?: boolean;
        priority: string;
      }>;
      const proactiveQuestion = payload?.proactiveQuestion as string | null | undefined;
      const nudges = generateNudges(tasks, proactiveQuestion);
      return { ok: true, data: nudges };
    } catch (err) {
      return { ok: false, error: String(err), data: [] };
    }
  });

  // Check if auto-reflection should trigger
  ipcMain.handle("memory:should-reflect", () => {
    try {
      return { ok: true, shouldReflect: shouldAutoReflect() };
    } catch (err) {
      return { ok: false, shouldReflect: false, error: String(err) };
    }
  });

  // Record task timing from a completed timer
  ipcMain.handle("memory:task-timing", (_event, payload) => {
    try {
      captureTaskTiming(
        payload.taskCategory,
        payload.taskTitle,
        payload.estimatedMinutes,
        payload.actualMinutes
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Get human-readable behavior profile for settings UI
  ipcMain.handle("memory:behavior-profile", () => {
    try {
      const entries = getBehaviorProfile();
      return { ok: true, data: entries };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Save user-edited behavior profile back to memory
  ipcMain.handle("memory:save-behavior-profile", (_event, payload) => {
    try {
      saveBehaviorProfile(payload.entries);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
}

// ── Window ──────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 800,
    minHeight: 600,
    title: "NorthStar 北极星",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(process.env.DIST!, "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ── App lifecycle ───────────────────────────────────────

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    closePool().catch(() => {});
    app.quit();
    mainWindow = null;
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("before-quit", () => {
  stopAPIServer().catch(() => {});
  closePool().catch(() => {});
});

app.whenReady().then(async () => {
  // Initialize SQLite database
  try {
    await testConnection();
    await runMigrations();
    _dbAvailable = true;
    setAPIDBAvailable(true);
    console.log("[DB] SQLite connected and migrations complete");

    // Set up semantic search (non-blocking)
    ensureVectorColumn()
      .then(() => backfillPreferenceEmbeddings())
      .then((count: number) => {
        if (count > 0) console.log(`[DB] Backfilled ${count} preference embeddings`);
      })
      .catch((err: unknown) => console.warn("[DB] Vector setup non-fatal:", err));
  } catch (err) {
    console.warn("[DB] SQLite unavailable, using JSON fallback:", err);
    _dbAvailable = false;
    setAPIDBAvailable(false);
  }

  // Load memory manager (async DB load)
  try {
    await ensureManagerReady();
    console.log("[Memory] Manager ready");
  } catch (err) {
    console.warn("[Memory] Manager init failed:", err);
  }

  // Start local API server (cloud-ready REST endpoints)
  try {
    const port = await startAPIServer();
    console.log(`[API] Local API server on port ${port}`);
  } catch (err) {
    console.warn("[API] API server failed to start (non-fatal):", err);
  }

  setupIPC();
  createWindow();

  // Initialize auto-updater (only in production builds)
  initAutoUpdater(mainWindow);

  // Record session start for behavioral tracking
  captureSessionStart();
});
