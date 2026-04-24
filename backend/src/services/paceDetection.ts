/**
 * Pace Detection — Server Re-export
 *
 * All logic now lives in @starward/core/domain/paceDetection so it can
 * run on both client and server. This file re-exports everything for
 * backward compatibility with existing server imports.
 */

export {
  detectPaceMismatches,
  detectCrossGoalOverload,
  splitPlan,
  mergePlans,
  countPlanStats,
} from "@starward/core";

export type {
  PaceMismatch,
  OverloadAdvisory,
  PlanSplit,
} from "@starward/core";
