/* Type declarations for the Electron preload bridge. */

interface ElectronAuth {
  openExternal: (url: string) => Promise<void>;
  oauthPopup: (url: string, redirectMatch: string) => Promise<string | null>;
  onDeepLink: (callback: (url: string) => void) => () => void;
}

interface Window {
  electronAuth?: ElectronAuth;
}
