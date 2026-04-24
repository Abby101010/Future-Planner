/* Starward server — model-config routes
 *
 * HTTP mirror of electron/ipc/modelConfig.ts. The model-config module is
 * process-global state (in-memory tier overrides), not user-scoped. Phase 1
 * accepts that — it's the same single-user assumption as the rest of the MVP.
 * Phase 2 will need to move overrides into a user-scoped table.
 */

import { Router } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import {
  getModelConfig,
  setModelOverrides,
  type ClaudeModel,
  type ModelTier,
} from "@starward/core";

export const modelConfigRouter = Router();

// POST /model-config/get
modelConfigRouter.post(
  "/get",
  asyncHandler(async (_req, res) => {
    res.json(getModelConfig());
  }),
);

// POST /model-config/set-overrides
modelConfigRouter.post(
  "/set-overrides",
  asyncHandler(async (req, res) => {
    const overrides = (req.body ?? {}) as Partial<
      Record<ModelTier, ClaudeModel>
    >;
    setModelOverrides(overrides);
    res.json({ ok: true });
  }),
);
