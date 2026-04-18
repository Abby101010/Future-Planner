/**
 * Pace Detection — Server Re-export
 *
 * All logic now lives in @northstar/core/domain/paceDetection so it can
 * run on both client and server. This file re-exports everything for
 * backward compatibility with existing server imports.
 */

export {
  detectPaceMismatches,
  detectCrossGoalOverload,
  splitPlan,
  mergePlans,
  countPlanStats,
} from "@northstar/core";

export type {
  PaceMismatch,
  OverloadAdvisory,
  PlanSplit,
} from "@northstar/core";
