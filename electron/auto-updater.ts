/* ──────────────────────────────────────────────────────────
   NorthStar — Auto-Updater (electron-updater)

   Checks GitHub Releases for new versions and downloads
   updates automatically. Users get a notification when a
   new version is ready to install.

   Flow:
   1. App starts → checks for updates (after 10s delay)
   2. If update available → downloads in background
   3. Shows notification to user → "Restart to update"
   4. On next restart → new version is applied

   Publish: `npm run electron:build:mac` creates the release
   artifacts, then push to GitHub Releases.
   ────────────────────────────────────────────────────────── */

import { autoUpdater } from "electron-updater";
import { BrowserWindow, dialog } from "electron";

/** Initialize the auto-updater. Call once from app.whenReady(). */
export function initAutoUpdater(mainWindow: BrowserWindow | null): void {
  // Don't check for updates in development
  if (process.env.VITE_DEV_SERVER_URL) {
    console.log("[Updater] Skipping update check in development mode");
    return;
  }

  // Configure
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // ── Events ──────────────────────────────────────────────

  autoUpdater.on("checking-for-update", () => {
    console.log("[Updater] Checking for updates...");
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`[Updater] Update available: v${info.version}`);
    // Notify the renderer
    mainWindow?.webContents.send("updater:status", {
      status: "downloading",
      version: info.version,
    });
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[Updater] App is up to date");
  });

  autoUpdater.on("download-progress", (progress) => {
    console.log(`[Updater] Download: ${Math.round(progress.percent)}%`);
    mainWindow?.webContents.send("updater:progress", {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log(`[Updater] Update downloaded: v${info.version}`);

    // Notify renderer
    mainWindow?.webContents.send("updater:status", {
      status: "ready",
      version: info.version,
    });

    // Show a native dialog asking to restart
    dialog
      .showMessageBox({
        type: "info",
        title: "Update Ready",
        message: `NorthStar v${info.version} has been downloaded.`,
        detail: "Restart the app to apply the update.",
        buttons: ["Restart Now", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
  });

  autoUpdater.on("error", (err) => {
    console.warn("[Updater] Error:", err.message);
    // Don't bother the user with update errors — just log them
  });

  // ── Check after a short delay (don't block startup) ────
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.warn("[Updater] Check failed (non-fatal):", err.message);
    });
  }, 10_000);
}
