/**
 * Shared helpers and re-exports used by all command domain modules.
 */

import type { CommandKind, QueryKind } from "@northstar/core";
import { getCurrentUserId } from "../../middleware/requestContext";
import { emitViewInvalidate } from "../../ws/events";
import { commandToInvalidations } from "../../views/_invalidation";
import { handleAIRequest, type RequestType } from "../../ai/router";
import { loadMemory, buildMemoryContext } from "../../memory";

// Re-export repos so domain files can `import { repos } from "./_helpers"`
export * as repos from "../../repositories";
export { getPool } from "../../db/pool";
export { getCurrentUserId } from "../../middleware/requestContext";
export { emitViewInvalidate, emitAgentProgress } from "../../ws/events";
export { loadMemory, buildMemoryContext, computeCapacityProfile } from "../../memory";
export { extractReplyFromText } from "@northstar/core/handlers";
export {
  applyPlanPatch,
  ADAPTIVE_RESCHEDULE_SYSTEM,
  getModelForTask,
  personalizeSystem,
} from "@northstar/core";
export type { TimeBlock, UserProfile, UserSettings } from "@northstar/core";
export { generateAndPersistDailyTasks } from "../../services/dailyTaskGeneration";
export { getEffectiveDate, getEffectiveDaysAgo } from "../../dateUtils";
export { splitPlan, mergePlans } from "../../services/paceDetection";
export { runStreamingHandler } from "../../ai/streaming";
export { getClient } from "../../ai/client";

// ── Small helpers ────────────────────────────────────────────

export function invalidate(
  kind: CommandKind,
  extraViews: QueryKind[] = [],
  scope?: { date?: string; entityId?: string; entityType?: string },
): void {
  const userId = getCurrentUserId();
  const base = commandToInvalidations[kind] ?? [];
  const merged = Array.from(new Set<QueryKind>([...base, ...extraViews]));
  emitViewInvalidate(userId, { viewKinds: merged, scope });
}

export async function runAI(
  type: RequestType,
  payload: Record<string, unknown>,
  contextType: "planning" | "daily" | "recovery" | "general" = "general",
): Promise<unknown> {
  const userId = getCurrentUserId();
  const memory = await loadMemory(userId);
  const memoryContext = buildMemoryContext(memory, contextType);
  return handleAIRequest(type, payload, memoryContext);
}
