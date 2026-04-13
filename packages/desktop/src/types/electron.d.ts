/* Type declarations for the Electron preload bridge. */

interface ElectronAuth {
  openExternal: (url: string) => Promise<void>;
  onDeepLink: (callback: (url: string) => void) => () => void;
}

interface Window {
  electronAuth?: ElectronAuth;
}
