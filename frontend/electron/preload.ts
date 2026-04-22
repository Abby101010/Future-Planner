/* ──────────────────────────────────────────────────────────
   NorthStar — Electron preload

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
