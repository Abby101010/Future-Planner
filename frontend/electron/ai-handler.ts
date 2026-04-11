/* NorthStar — AI handler (transition barrel)
 *
 * The real implementation now lives under electron/ai/. This file is
 * kept as a thin re-export so existing importers (main.ts, api-server.ts,
 * job-runner.ts, agents/coordinator.ts) do not need to change their paths.
 */

export { handleAIRequest, handleAIRequestDirect } from "./ai/router";
export type { RequestType } from "./ai/router";
