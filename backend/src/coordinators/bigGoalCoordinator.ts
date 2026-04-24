/**
 * Big Goal Coordinator — handles everything related to long-term goal
 * creation, research, planning, breakdown, and lifecycle.
 *
 * Flow:
 *   User input → Effort Router (Haiku) → HIGH or LOW
 *
 *   HIGH → Parallel: Research Agent + Personalization Agent
 *        → Opus synthesizes → plan generated → approval loop
 *        → On confirm: save Project Agent Context
 *
 *   LOW  → Sonnet processes directly → approval
 *        → Denied 2+ times → offer upgrade to Big Goal (Opus path)
 */

import { emitAgentProgress } from "../ws";
import { getCurrentUserId } from "../middleware/requestContext";
import { routeEffort, type EffortRouterInput } from "./effortRouter";
import { classifyEffort } from "@starward/core";
import { runResearchAgent, type ResearchResult } from "./bigGoal/researchAgent";
import { runPersonalizationAgent, type PersonalizationResult } from "./bigGoal/personalizationAgent";
import { loadProjectContext, saveProjectContext, type ProjectAgentContext } from "./bigGoal/projectAgentContext";

// ── Types ──────────────────────────────────────────────────

export interface BigGoalRequest {
  /** What the user said/wants */
  userMessage: string;
  /** Goal details (if creating/modifying a specific goal) */
  goal?: {
    id: string;
    title: string;
    description: string;
    targetDate: string;
    importance: string;
    goalType: string;
  };
  /** Existing goals for context */
  existingGoals: Array<{ title: string; goalType: string; status: string }>;
  /** Today's task count for load context */
  todayTaskCount: number;
  /** Current cognitive load */
  currentCognitiveLoad: number;
  /** How many times the user has denied a low-effort result for this request */
  denialCount?: number;
}

export interface BigGoalResult {
  /** Which path was taken */
  effort: "high" | "low";
  /** Research findings (high-effort path only) */
  research: ResearchResult | null;
  /** Personalization data */
  personalization: PersonalizationResult | null;
  /** Whether Project Agent Context was loaded (follow-up on existing goal) */
  projectContextLoaded: boolean;
  /** Memory context string for prompt injection */
  memoryContext: string;
  /** Capacity context string for prompt injection */
  capacityContext: string;
  /** Whether to suggest upgrading to Big Goal (low-effort denied 2+ times) */
  suggestUpgrade: boolean;
}

// ── Coordinator ────────────────────────────────────────────

export async function coordinateBigGoal(
  request: BigGoalRequest,
): Promise<BigGoalResult> {
  const userId = getCurrentUserId();

  emitAgentProgress(userId, {
    agentId: "coordinator",
    phase: "routing",
    message: "Classifying request effort level...",
  });

  // Step 1: Route effort — local heuristic first (ACONIC pattern),
  // fall back to Haiku when confidence is low.
  const effortInput: EffortRouterInput = {
    userMessage: request.userMessage,
    existingGoals: request.existingGoals,
    todayTaskCount: request.todayTaskCount,
    currentCognitiveLoad: request.currentCognitiveLoad,
  };

  const localClassification = classifyEffort(effortInput);
  const effortResult =
    localClassification.confidence >= 0.6
      ? localClassification
      : await routeEffort(effortInput);

  // If low-effort has been denied 2+ times, force high-effort
  const forceHigh = (request.denialCount ?? 0) >= 2;
  const effort = forceHigh ? "high" : effortResult.effort;

  emitAgentProgress(userId, {
    agentId: "coordinator",
    phase: "classified",
    message: `Request classified as ${effort.toUpperCase()} effort${forceHigh ? " (upgraded after denials)" : ""}`,
  });

  // Step 2: Check for existing Project Agent Context (follow-up on existing goal)
  let projectContextLoaded = false;
  let existingContext: ProjectAgentContext | null = null;
  if (request.goal?.id) {
    existingContext = await loadProjectContext(request.goal.id);
    projectContextLoaded = existingContext !== null;
    if (projectContextLoaded) {
      emitAgentProgress(userId, {
        agentId: "coordinator",
        phase: "context-loaded",
        message: "Loaded existing goal context — fast follow-up mode",
      });
    }
  }

  // Step 3: Run path-specific agents
  if (effort === "high") {
    return runHighEffortPath(request, userId, existingContext, projectContextLoaded);
  } else {
    return runLowEffortPath(request, userId);
  }
}

// ── High-Effort Path (Opus + Research + Personalization) ───

async function runHighEffortPath(
  request: BigGoalRequest,
  userId: string,
  existingContext: ProjectAgentContext | null,
  projectContextLoaded: boolean,
): Promise<BigGoalResult> {
  emitAgentProgress(userId, {
    agentId: "coordinator",
    phase: "parallel",
    message: "Running research + personalization agents in parallel...",
  });

  // Run both sub-agents in parallel
  const [research, personalization] = await Promise.all([
    // Skip research if we already have it from a prior session
    existingContext?.research
      ? Promise.resolve(existingContext.research)
      : runResearchAgent({
          goalTitle: request.goal?.title ?? request.userMessage,
          goalDescription: request.goal?.description ?? "",
          targetDate: request.goal?.targetDate ?? "",
          importance: request.goal?.importance ?? "medium",
        }),
    runPersonalizationAgent(),
  ]);

  emitAgentProgress(userId, {
    agentId: "coordinator",
    phase: "synthesizing",
    message: "Research and personalization complete — preparing plan...",
  });

  return {
    effort: "high",
    research,
    personalization,
    projectContextLoaded,
    memoryContext: personalization.memoryContext,
    capacityContext: personalization.capacityContext,
    suggestUpgrade: false,
  };
}

// ── Low-Effort Path (Sonnet direct) ───────────────────────

async function runLowEffortPath(
  request: BigGoalRequest,
  userId: string,
): Promise<BigGoalResult> {
  emitAgentProgress(userId, {
    agentId: "coordinator",
    phase: "quick",
    message: "Processing with quick path...",
  });

  // Still run personalization for context, but skip research
  const personalization = await runPersonalizationAgent();

  const suggestUpgrade = (request.denialCount ?? 0) >= 2;

  return {
    effort: "low",
    research: null,
    personalization,
    projectContextLoaded: false,
    memoryContext: personalization.memoryContext,
    capacityContext: personalization.capacityContext,
    suggestUpgrade,
  };
}

// ── Save context on goal confirmation ─────────────────────

/**
 * Called when a big goal plan is confirmed. Saves the Project Agent
 * Context so follow-up conversations are fast and context-aware.
 */
export async function onGoalConfirmed(
  goalId: string,
  research: ResearchResult | null,
  personalization: PersonalizationResult | null,
  decisions: string[],
): Promise<void> {
  const context: ProjectAgentContext = {
    research,
    personalization: personalization
      ? {
          avgTasksPerDay: personalization.avgTasksPerDay,
          completionRate: personalization.completionRate,
          maxDailyWeight: personalization.maxDailyWeight,
          overwhelmRisk: personalization.overwhelmRisk,
          trend: personalization.trend,
        }
      : null,
    decisions,
    updatedAt: new Date().toISOString(),
  };

  await saveProjectContext(goalId, context);
}
