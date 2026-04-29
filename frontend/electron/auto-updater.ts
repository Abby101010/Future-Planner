/* ──────────────────────────────────────────────────────────
   Starward — Auto-Updater (silent mode)

   The .dmg is now signed with Developer ID Application:
   Hanyang Zhuo (9A9AU2A7N6) and notarized, so Squirrel.Mac
   accepts updates from GitHub Releases without prompting
   the user to drag a new dmg manually. This is the same
   model Discord, Slack, and most Electron apps use:

   1. App starts → 10s later, queries GitHub Releases.
   2. New version found → downloads in background, no dialog.
   3. User quits the app → updater swaps the .app bundle.
   4. Next launch → user is on the new version. Zero clicks.

   On error (network blip, signature mismatch, etc.) we just
   log and try again next launch — never bother the user
   with update plumbing.

   The brief notify-only era (v0.1.31 and earlier, before the
   Developer ID cert + notarization landed) is documented in
   git history: see commit history of this file.
   ────────────────────────────────────────────────────────── */

import { autoUpdater } from "electron-updater";
import { BrowserWindow } from "electron";

/** Initialize the auto-updater. Call once from app.whenReady(). */
export function initAutoUpdater(mainWindow: BrowserWindow | null): void {
  // Don't check for updates in development
  if (process.env.VITE_DEV_SERVER_URL) {
    console.log("[Updater] Skipping update check in development mode");
    return;
  }

  // Silent mode: download in background, install on app quit.
  // Squirrel.Mac verifies the new build's signature matches the
  // installed app's identity before applying — for that to succeed,
  // the new release on GitHub must be signed with the SAME
  // Developer ID Application cert (Hanyang Zhuo, team 9A9AU2A7N6)
  // and notarized. The release pipeline (electron-builder
  // electron:build:mac → notarytool submit → stapler staple → gh
  // release upload) preserves this. If you ever publish a build
  // signed with a different cert, Squirrel will reject the update
  // silently — the user stays on their current version (no harm,
  // no data loss).
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  // ── Events ──────────────────────────────────────────────

  autoUpdater.on("checking-for-update", () => {
    console.log("[Updater] Checking for updates...");
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`[Updater] Update available: v${info.version}; downloading in background`);
  });

  autoUpdater.on("download-progress", (p) => {
    // Throttled by electron-updater itself; this just logs progress.
    console.log(`[Updater] Downloading update: ${Math.round(p.percent)}%`);
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log(
      `[Updater] Update v${info.version} downloaded; will install on next quit.`,
    );
    // Notify the renderer so it can show a dismissible badge with
    // version + concise release notes. The update STILL installs
    // automatically on app quit; the badge is purely informational
    // ("here's what's new in the version that'll apply when you
    // restart"). User clicks the X → badge hides for this session.
    // electron-updater puts release notes in info.releaseNotes;
    // it can be a string or an array of {version, note} entries
    // depending on the publish provider — pass through as-is and let
    // the renderer normalize.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("update:downloaded", {
        version: info.version,
        releaseNotes: info.releaseNotes ?? null,
        releaseName: info.releaseName ?? null,
        releaseDate: info.releaseDate ?? null,
      });
    }
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
