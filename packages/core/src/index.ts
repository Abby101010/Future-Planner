export * from "./types/index.js";
export * from "./types/agents.js";
export * from "./ai/sanitize.js";
export * from "./ai/personalize.js";
export * from "./ai/prompts.js";
// payloads.ts has a narrower `DeviceIntegrations` that collides with the
// richer one in types/index.ts. Re-export everything except that one name
// so downstream code keeps the canonical type from types/index.ts.
export {
  type EnrichedPayload,
  type OnboardingPayload,
  type ClassifyGoalPayload,
  type GenerateGoalPlanPayload,
  type GoalPlanChatPayload,
  type GoalPlanEditPayload,
  type AnalyzeMonthlyContextPayload,
  type HomeChatPayload,
  type RecoveryPayload,
  type AnalyzeQuickTaskPayload,
  type PaceCheckPayload,
  type GoalBreakdownPayload,
  type ReallocatePayload,
  type DailyTasksPayload,
  type AIPayloadMap,
} from "./ai/payloads.js";
export * from "./model-config.js";
export * from "./domain/cognitiveBudget.js";
export * from "./domain/goalPlan.js";
// AI handlers are server-only (pull in @anthropic-ai/sdk + node:crypto).
// Server code imports them from "@northstar/core/handlers". Never re-export
// them here — the desktop renderer consumes this barrel through a Vite alias.
export * from "./protocol/index.js";
