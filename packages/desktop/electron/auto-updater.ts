/* ──────────────────────────────────────────────────────────
   NorthStar — Auto-Updater (notify-only mode)

   Because the macOS .dmg is not code-signed (no Apple
   Developer cert), Squirrel.Mac refuses to silently apply
   updates. So instead of attempting auto-install, we use
   electron-updater purely to *detect* new versions on
   GitHub Releases, then prompt the user to download the
   new .dmg in their browser. One click instead of zero
   clicks, but no manual version-hunting.

   Flow:
   1. App starts → checks GitHub Releases (after 10s delay)
   2. If a newer version is published → native dialog
   3. User clicks "Download" → opens the Releases page in
      their browser; they drag the new .dmg over the old one
   4. User clicks "Later" → dialog dismisses, asks again
      next launch

   When/if you get an Apple Developer cert, swap this back
   to autoDownload + quitAndInstall and the app will update
   silently like a normal Mac app.
   ────────────────────────────────────────────────────────── */

import { autoUpdater } from "electron-updater";
import { BrowserWindow, dialog, shell } from "electron";

const RELEASES_URL =
  "https://github.com/Abby101010/Future-Planner/releases/latest";

/** Initialize the auto-updater. Call once from app.whenReady(). */
export function initAutoUpdater(_mainWindow: BrowserWindow | null): void {
  // Don't check for updates in development
  if (process.env.VITE_DEV_SERVER_URL) {
    console.log("[Updater] Skipping update check in development mode");
    return;
  }

  // Notify-only: do NOT auto-download (would fail on unsigned macOS build)
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  // ── Events ──────────────────────────────────────────────

  autoUpdater.on("checking-for-update", () => {
    console.log("[Updater] Checking for updates...");
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`[Updater] Update available: v${info.version}`);

    // Native dialog asking the user to grab the new .dmg
    dialog
      .showMessageBox({
        type: "info",
        title: "Update Available",
        message: `NorthStar v${info.version} is available.`,
        detail:
          "Click Download to open the releases page, then drag the new .dmg over your installed app.",
        buttons: ["Download", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          shell.openExternal(RELEASES_URL).catch((err) => {
            console.warn("[Updater] Failed to open releases page:", err);
          });
        }
      });
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[Updater] App is up to date");
  });

  autoUpdater.on("error", (err) => {
    console.warn("[Updater] Error:", err.message);
    // Don't bother the user with update errors — just log them
  });

  // ── Check after a short delay (don't block startup) ────
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.warn("[Updater] Check failed (non-fatal):", err.message);
    });
  }, 10_000);
}
