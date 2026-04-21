/* NorthStar core — server-only AI handler barrel.
 *
 * These handlers pull in @anthropic-ai/sdk and node:crypto, so they must
 * NOT be re-exported from ./index.ts (which is consumed by the browser
 * renderer via a Vite alias). Import them from "@northstar/core/handlers"
 * inside server code only.
 */

export * from "./ai/handlers/onboarding.js";
export * from "./ai/handlers/onboardingExtract.js";
export * from "./ai/handlers/classifyGoal.js";
export * from "./ai/handlers/goalPlanChat.js";
export * from "./ai/handlers/goalPlanEdit.js";
export * from "./ai/handlers/generateGoalPlan.js";
export * from "./ai/handlers/analyzeMonthlyContext.js";
export * from "./ai/handlers/homeChat.js";
export * from "./ai/handlers/chat.js";
