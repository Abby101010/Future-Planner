/* ──────────────────────────────────────────────────────────
   NorthStar — Electron preload

   Exposes a minimal `electronAuth` bridge so the renderer can:
   - Open OAuth URLs in the system browser
   - Receive deep-link callbacks from the main process
   ────────────────────────────────────────────────────────── */

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAuth", {
  /** Open a URL in the system browser (used for OAuth). */
  openExternal: (url: string) => ipcRenderer.invoke("auth:open-external", url),

  /** Listen for deep-link URLs forwarded from the main process. */
  onDeepLink: (callback: (url: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, url: string) =>
      callback(url);
    ipcRenderer.on("auth:deep-link", handler);
    // Return an unsubscribe function.
    return () => ipcRenderer.removeListener("auth:deep-link", handler);
  },
});
