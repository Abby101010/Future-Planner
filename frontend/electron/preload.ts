import { contextBridge, ipcRenderer } from "electron";

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object.
contextBridge.exposeInMainWorld("electronAPI", {
  send: (channel: string, data: unknown) => {
    ipcRenderer.send(channel, data);
  },
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const wrapped = (_event: unknown, ...args: unknown[]) => callback(...args);
    ipcRenderer.on(channel, wrapped);
    // Return an unsubscribe function that removes the actual wrapper we registered
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
  invoke: (channel: string, ...args: unknown[]) => {
    return ipcRenderer.invoke(channel, ...args);
  },
});
