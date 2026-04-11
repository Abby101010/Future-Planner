/* ──────────────────────────────────────────────────────────
   NorthStar — Electron main process

   Responsibilities kept here:
   - .env bootstrap
   - Data persistence (SQLite + JSON fallback)
   - Window lifecycle
   - app.whenReady() startup sequence
   - IPC context initialization (actual handlers live in electron/ipc/)
   ────────────────────────────────────────────────────────── */

import { app, BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs";
import { loadMemory, ensureManagerReady } from "./memory";
import { captureSessionStart } from "./reflection";
import {
  testConnection,
  runMigrations,
  closePool,
  loadAppData,
  saveAppData,
  ensureVectorColumn,
  backfillPreferenceEmbeddings,
} from "./database";
import { terminateReflectionWorker } from "./reflection-worker-client";
import { initAutoUpdater } from "./auto-updater";
import { setModelOverrides } from "../../shared/model-config";
import type { ModelTier, ClaudeModel } from "../../shared/model-config";
import { initIpcContext } from "./ipc/context";
import { setupIPC } from "./ipc/register";

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

// ── Data persistence (SQLite-backed, JSON fallback) ─
const isDev = !app.isPackaged;
const userDataPath = isDev
  ? path.join(app.getPath("userData"), "dev-data")
  : app.getPath("userData");
fs.mkdirSync(userDataPath, { recursive: true });
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
  terminateReflectionWorker().catch(() => {});
  closePool().catch(() => {});
});

app.whenReady().then(async () => {
  // Initialize SQLite database
  try {
    await testConnection();
    await runMigrations();
    _dbAvailable = true;
    console.log("[DB] SQLite connected and migrations complete");

    // Set up semantic search (non-blocking)
    ensureVectorColumn()
      .then(() => backfillPreferenceEmbeddings())
      .then((count: number) => {
        if (count > 0)
          console.log(`[DB] Backfilled ${count} preference embeddings`);
      })
      .catch((err: unknown) =>
        console.warn("[DB] Vector setup non-fatal:", err),
      );
  } catch (err) {
    console.warn("[DB] SQLite unavailable, using JSON fallback:", err);
    _dbAvailable = false;
  }

  // Load memory manager (async DB load)
  try {
    await ensureManagerReady();
    loadMemory();
    console.log("[Memory] Manager ready");
  } catch (err) {
    console.warn("[Memory] Manager init failed:", err);
  }

  // Initialize model overrides from saved settings
  try {
    const data = loadDataSync();
    const user = data.user as Record<string, unknown> | undefined;
    const settings = user?.settings as Record<string, unknown> | undefined;
    const modelOverrides = settings?.modelOverrides as
      | Partial<Record<ModelTier, ClaudeModel>>
      | undefined;
    if (modelOverrides) {
      setModelOverrides(modelOverrides);
      console.log("[Models] Loaded user model overrides:", modelOverrides);
    }
  } catch {
    /* no overrides yet */
  }

  // Initialize shared IPC context, then register all per-domain handlers
  initIpcContext({
    getMainWindow: () => mainWindow,
    setMainWindow: (w) => {
      mainWindow = w;
    },
    isDbAvailable: () => _dbAvailable,
    setDbAvailable: (v) => {
      _dbAvailable = v;
    },
    loadData,
    saveData,
    loadDataSync,
  });
  setupIPC();
  createWindow();

  // Initialize auto-updater (only in production builds)
  initAutoUpdater(mainWindow);

  // Record session start for behavioral tracking
  captureSessionStart();
});
