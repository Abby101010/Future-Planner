/* ──────────────────────────────────────────────────────────
   Starward — Electron preload

   Exposes a minimal `electronAuth` bridge so the renderer can:
   - Open OAuth URLs in the system browser
   - Receive deep-link callbacks from the main process
   ────────────────────────────────────────────────────────── */

import { contextBridge, ipcRenderer } from "electron";

/* ── Notification bridge ── */
contextBridge.exposeInMainWorld("electronNotifications", {
  show: (title: string, body: string) =>
    ipcRenderer.invoke("notification:show", title, body),
});

/* ── Auto-updater bridge ──
 * Lets the renderer subscribe to update-downloaded events so it
 * can show a dismissible "what's new" badge. The update itself
 * still applies automatically on app quit (Discord-style); the
 * badge is informational. See electron/auto-updater.ts. */
contextBridge.exposeInMainWorld("electronUpdater", {
  onDownloaded: (
    callback: (info: {
      version: string;
      releaseNotes: string | { version: string; note?: string }[] | null;
      releaseName: string | null;
      releaseDate: string | null;
    }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      info: Parameters<typeof callback>[0],
    ) => callback(info);
    ipcRenderer.on("update:downloaded", handler);
    return () => ipcRenderer.removeListener("update:downloaded", handler);
  },
});

contextBridge.exposeInMainWorld("electronAuth", {
  /** Open a URL in the system browser (used for OAuth). */
  openExternal: (url: string) => ipcRenderer.invoke("auth:open-external", url),

  /**
   * Open an in-app popup window for OAuth.  Returns the auth code extracted
   * from the final redirect URL, or null if the user closed the popup.
   */
  oauthPopup: (url: string, redirectMatch: string): Promise<string | null> =>
    ipcRenderer.invoke("auth:oauth-popup", url, redirectMatch),

  /** Listen for deep-link URLs forwarded from the main process. */
  onDeepLink: (callback: (url: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, url: string) =>
      callback(url);
    ipcRenderer.on("auth:deep-link", handler);
    // Return an unsubscribe function.
    return () => ipcRenderer.removeListener("auth:deep-link", handler);
  },
});
