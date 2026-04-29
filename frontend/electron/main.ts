/* ──────────────────────────────────────────────────────────
   Starward — Electron main process

   Phase 2a: the Electron shell is now display-only. All data,
   calendar, environment, and AI logic lives on the server.
   This process only:
   - Loads .env in development
   - Creates and manages the BrowserWindow
   - Loads the dev URL or the built renderer file
   - Initializes the auto-updater (notify-only)

   No IPC handlers are registered here anymore.
   ────────────────────────────────────────────────────────── */

import { app, BrowserWindow, Notification, session, shell, ipcMain } from "electron";
import path from "node:path";
import fs from "node:fs";
import { initAutoUpdater } from "./auto-updater";
import {
  DEV_LOG_ENABLED as DEV_LOG_MAIN_ENABLED,
  appendDevLogMain,
  initDevLogMain,
  shutdownDevLogMain,
} from "./dev-log-writer";
import type { DevLogEntryInput } from "../../backend/core/src/devLog/index";

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

process.env.DIST = path.join(__dirname, "../dist");
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, "../public");

// ── Deep-link protocol for OAuth callback ──
const PROTOCOL = "starward";
if (process.defaultApp) {
  // Dev mode: register with the full path so the OS can re-launch
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// Single-instance lock — if a second instance launches (e.g. from a deep
// link on Windows/Linux), forward the URL to the existing instance.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];

/** Forward a deep-link URL to the renderer. */
function handleDeepLink(url: string): void {
  if (!url.startsWith(`${PROTOCOL}://`)) return;
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send("auth:deep-link", url);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 800,
    minHeight: 600,
    title: "Starward 星程",
    icon: path.join(process.env.VITE_PUBLIC!, "icon.png"),
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

// macOS: deep links arrive via open-url
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// Windows / Linux: deep links arrive via second-instance
app.on("second-instance", (_event, commandLine) => {
  const url = commandLine.find((arg) => arg.startsWith(`${PROTOCOL}://`));
  if (url) handleDeepLink(url);
});

// IPC: show a native OS notification (used for reminder alerts)
ipcMain.handle("notification:show", (_event, title: string, body: string) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});

// IPC: let the renderer open URLs in the system browser (for OAuth).
// Restrict to http/https — a compromised renderer could otherwise hand
// shell.openExternal a file:// or custom-scheme URL.
ipcMain.handle("auth:open-external", (_event, url: string) => {
  try {
    const { protocol } = new URL(url);
    if (protocol !== "https:" && protocol !== "http:") return;
    shell.openExternal(url);
  } catch {
    // ignore malformed URLs
  }
});

// IPC: open an in-app OAuth popup — stays inside the Electron app instead of
// launching the system browser.  Returns the auth code extracted from the
// final redirect URL so the renderer can exchange it for a session.
ipcMain.handle(
  "auth:oauth-popup",
  (_event, url: string, redirectMatch: string) => {
    return new Promise<string | null>((resolve) => {
      const popup = new BrowserWindow({
        width: 500,
        height: 700,
        parent: mainWindow ?? undefined,
        modal: true,
        show: false,
        title: "Sign in",
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });

      popup.once("ready-to-show", () => popup.show());

      let resolved = false;
      const tryExtractCode = (navUrl: string) => {
        if (resolved) return;
        try {
          const parsed = new URL(navUrl);
          if (navUrl.startsWith(redirectMatch)) {
            const code = parsed.searchParams.get("code");
            if (code) {
              resolved = true;
              popup.close();
              resolve(code);
            }
          }
        } catch {
          // ignore malformed URLs
        }
      };

      popup.webContents.on("will-navigate", (_e, navUrl) =>
        tryExtractCode(navUrl),
      );
      popup.webContents.on("will-redirect", (_e, navUrl) =>
        tryExtractCode(navUrl),
      );
      popup.webContents.on("did-navigate", (_e, navUrl) =>
        tryExtractCode(navUrl),
      );

      popup.on("closed", () => {
        if (!resolved) resolve(null);
      });

      popup.loadURL(url);
    });
  },
);

app.whenReady().then(async () => {
  // Grant geolocation permission so the renderer can collect GPS
  // coordinates for weather-aware task scheduling.
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(permission === "geolocation");
    },
  );

  // Initialize the dev-log writer (gated on !packaged + env var).
  // Must precede the renderer load so the IPC handler is registered
  // before the first `electronDevLog.append` call lands.
  await initDevLogMain();

  createWindow();
  initAutoUpdater(mainWindow);
});

// IPC: renderer ships dev-log entries here. Fire-and-forget — the
// renderer doesn't await the result; we still return a Promise so the
// invoke()/handle() pairing works.
ipcMain.handle("dev-log:append", (_event, entry: DevLogEntryInput) => {
  if (!DEV_LOG_MAIN_ENABLED) return;
  appendDevLogMain(entry);
});

// Best-effort flush + close of the writer on quit so the file isn't
// truncated mid-line. before-quit fires before windows close.
app.on("before-quit", async (event) => {
  if (!DEV_LOG_MAIN_ENABLED) return;
  event.preventDefault();
  try {
    await shutdownDevLogMain();
  } catch {
    /* ignore */
  }
  app.exit(0);
});
