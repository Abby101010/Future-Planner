/* ──────────────────────────────────────────────────────────
   NorthStar — Electron main process

   Phase 13: the SQLite + JSON data layer was deleted. The desktop
   app is now a thin shell that loads the renderer and exposes a
   few macOS-only IPCs (device calendar, environment info). All
   data lives on the Fly.io backend + Supabase Postgres.

   Responsibilities kept here:
   - .env bootstrap
   - Window lifecycle
   - app.whenReady() startup sequence
   - IPC handler registration (the handlers themselves live in
     electron/ipc/)
   ────────────────────────────────────────────────────────── */

import { app, BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs";
import { initAutoUpdater } from "./auto-updater";
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
    app.quit();
    mainWindow = null;
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(async () => {
  initIpcContext({
    getMainWindow: () => mainWindow,
    setMainWindow: (w) => {
      mainWindow = w;
    },
  });
  setupIPC();
  createWindow();
  initAutoUpdater(mainWindow);
});
