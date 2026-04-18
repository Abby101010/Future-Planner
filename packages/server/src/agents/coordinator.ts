/* ──────────────────────────────────────────────────────────
   NorthStar — Agent Coordinator

   Orchestrates the sub-agent pipeline. Creates initial
   TaskState, routes to the correct agent plan, runs parallel
   and sequential agent groups, and merges results.
   ────────────────────────────────────────────────────────── */

import { randomUUID } from "node:crypto";
import { emitAgentProgress } from "../ws";
import { getCurrentUserId } from "../middleware/requestContext";
import type {
  TaskState,
  TaskStateInput,
  GatekeeperResult,
  TimeEstimatorResult,
  SchedulerResult,
  SubAgentId,
} from "@northstar/core";
import { routeRequest } from "./router";
import { runGatekeeper } from "./gatekeeper";
import { runTimeEstimator } from "./timeEstimator";
import { runScheduler } from "./scheduler";

// ── HiTAMP error categorization & retry ───────────────────

type AgentErrorKind = "timeout" | "parse_error" | "api_error" | "rate_limit" | "unknown";

function categorizeAgentError(err: unknown): AgentErrorKind {
  const msg = err instanceof Error ? err.message : String(err);
  if (/timeout|timed?\s*out|ETIMEDOUT/i.test(msg)) return "timeout";
  if (/parse|JSON|unexpected token|invalid/i.test(msg)) return "parse_error";
  if (/rate.?limit|429|too many/i.test(msg)) return "rate_limit";
  if (/5\d{2}|api|network|ECONNREFUSED|ECONNRESET/i.test(msg)) return "api_error";
  return "unknown";
}

function isRetryable(kind: AgentErrorKind): boolean {
  return kind === "timeout" || kind === "rate_limit" || kind === "api_error";
}

const RETRY_DELAY_MS = 2000;
const MAX_RETRIES = 1;

// ── Agent runner dispatch ──────────────────────────────────

type AgentResults = {
  gatekeeper: GatekeeperResult | null;
  timeEstimator: TimeEstimatorResult | null;
  scheduler: SchedulerResult | null;
};

async function runAgent(
  agentId: SubAgentId,
  input: TaskStateInput,
  results: AgentResults,
): Promise<void> {
  switch (agentId) {
    case "gatekeeper": {
      results.gatekeeper = await runGatekeeper(input);
      break;
    }
    case "timeEstimator": {
      results.timeEstimator = await runTimeEstimator(input);
      break;
    }
    case "scheduler": {
      // Scheduler depends on gatekeeper + timeEstimator results
      const gk = results.gatekeeper ?? {
        filteredTasks: [],
        priorityScores: {},
        budgetCheck: { totalWeight: 0, maxWeight: 12, overBudget: false, tasksDropped: [] },
        goalRotation: { goalCount: 0, rotationScores: {}, staleGoals: [] },
      };
      const te = results.timeEstimator ?? {
        estimates: {},
        totalMinutes: 0,
        exceedsDeepWorkCeiling: false,
      };
      results.scheduler = await runScheduler(input, gk, te);
      break;
    }
  }
}

/** Run an agent with retry on transient errors (HiTAMP pattern). */
async function runAgentWithRetry(
  agentId: SubAgentId,
  input: TaskStateInput,
  results: AgentResults,
  userId: string,
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await runAgent(agentId, input, results);
      return;
    } catch (err) {
      const kind = categorizeAgentError(err);
      const { recordAgentFallback } = await import("../services/signalRecorder");
      recordAgentFallback(agentId, kind).catch(() => {});

      if (isRetryable(kind) && attempt < MAX_RETRIES) {
        emitAgentProgress(userId, {
          agentId,
          phase: "retrying",
          message: `${agentId} failed (${kind}), retrying in ${RETRY_DELAY_MS / 1000}s...`,
        });
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw err;
    }
  }
}

// ── Coordinator ────────────────────────────────────────────

export async function coordinateRequest(
  requestType: string,
  input: TaskStateInput,
): Promise<TaskState> {
  const id = randomUUID();
  const userId = getCurrentUserId();

  const state: TaskState = {
    id,
    requestType,
    status: "pending",
    createdAt: new Date().toISOString(),
    input,
    agents: {
      gatekeeper: null,
      timeEstimator: null,
      scheduler: null,
    },
    output: null,
    error: null,
  };

  try {
    // Route the request
    state.status = "routing";
    emitAgentProgress(userId, {
      agentId: "coordinator",
      phase: "routing",
      message: `Routing request: ${requestType}`,
    });

    const plan = routeRequest(requestType);

    if (plan.agents.length === 0) {
      state.status = "enriched";
      return state;
    }

    state.status = "processing";

    const results: AgentResults = {
      gatekeeper: null,
      timeEstimator: null,
      scheduler: null,
    };

    // Run parallel agent groups
    for (const group of plan.parallel) {
      emitAgentProgress(userId, {
        agentId: "coordinator",
        phase: "parallel",
        message: `Running in parallel: ${group.join(", ")}`,
      });

      await Promise.all(
        group.map(async (agentId) => {
          emitAgentProgress(userId, {
            agentId: agentId,
            phase: "starting",
            message: `Starting ${agentId}`,
          });

          await runAgentWithRetry(agentId, input, results, userId);

          emitAgentProgress(userId, {
            agentId: agentId,
            phase: "complete",
            message: `${agentId} complete`,
          });
        }),
      );
    }

    // Run sequential agents with accumulated results
    for (const agentId of plan.sequential) {
      emitAgentProgress(userId, {
        agentId: agentId,
        phase: "starting",
        message: `Starting ${agentId}`,
      });

      await runAgentWithRetry(agentId, input, results, userId);

      emitAgentProgress(userId, {
        agentId: agentId,
        phase: "complete",
        message: `${agentId} complete`,
      });
    }

    // Merge results into TaskState
    state.agents.gatekeeper = results.gatekeeper;
    state.agents.timeEstimator = results.timeEstimator;
    state.agents.scheduler = results.scheduler;
    state.status = "enriched";

    emitAgentProgress(userId, {
      agentId: "coordinator",
      phase: "done",
      message: "All agents complete",
    });

    return state;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[coordinator] Error processing ${requestType}:`, message);

    state.status = "error";
    state.error = message;

    emitAgentProgress(userId, {
      agentId: "coordinator",
      phase: "error",
      message: `Error: ${message}`,
    });

    return state;
  }
}
