/// <reference types="vite/client" />

/** Build-time feature flag: true when NORTHSTAR_EDITION=personal */
declare const __PERSONAL_EDITION__: boolean;

interface Window {
  electronAPI: {
    send: (channel: string, data: unknown) => void;
    on: (channel: string, callback: (...args: unknown[]) => void) => void;
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  };
}
