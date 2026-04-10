/* NorthStar — model-config IPC handlers */

import { ipcMain } from "electron";
import { setModelOverrides, getModelConfig } from "../model-config";
import type { ModelTier, ClaudeModel } from "../model-config";

export function registerModelConfigIpc(): void {
  ipcMain.handle("model-config:get", () => {
    return getModelConfig();
  });

  ipcMain.handle(
    "model-config:set-overrides",
    (_event, overrides: Partial<Record<ModelTier, ClaudeModel>>) => {
      setModelOverrides(overrides);
      return { ok: true };
    },
  );
}
