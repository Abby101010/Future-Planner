/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    send: (channel: string, data: unknown) => void;
    on: (channel: string, callback: (...args: unknown[]) => void) => (() => void) | void;
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  };
  /** Dev-only bridge for shipping dev-log entries to the Electron main
   *  process writer. Undefined when running outside Electron (e.g. plain
   *  vite preview) or when the dev-log feature is disabled. */
  electronDevLog?: {
    append: (entry: unknown) => Promise<void>;
  };
}
