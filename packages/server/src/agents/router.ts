import type { AgentPlan, SubAgentId } from "@northstar/core";

export function routeRequest(requestType: string): AgentPlan {
  switch (requestType) {
    case "daily-tasks":
    case "adaptive-reschedule":
      return {
        agents: ["gatekeeper", "timeEstimator", "scheduler"],
        parallel: [["gatekeeper", "timeEstimator"]],
        sequential: ["scheduler"],
        dependencies: { scheduler: ["gatekeeper", "timeEstimator"] },
      };

    case "goal-intake":
      return {
        agents: ["gatekeeper", "scheduler"],
        parallel: [["gatekeeper"]],
        sequential: ["scheduler"],
        dependencies: { scheduler: ["gatekeeper"] },
      };

    case "budget-check":
      return {
        agents: ["gatekeeper"],
        parallel: [["gatekeeper"]],
        sequential: [],
      };

    case "generate-goal-plan":
      return {
        agents: ["timeEstimator", "scheduler"],
        parallel: [["timeEstimator"]],
        sequential: ["scheduler"],
        dependencies: { scheduler: ["timeEstimator"] },
      };

    default:
      return { agents: [], parallel: [], sequential: [] };
  }
}

export function needsCoordination(requestType: string): boolean {
  const plan = routeRequest(requestType);
  return plan.agents.length > 0;
}
