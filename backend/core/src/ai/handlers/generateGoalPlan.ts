/* Starward — Generate Goal Plan handler (initial plan) */

import Anthropic from "@anthropic-ai/sdk";
import { getModelForTask } from "../../model-config.js";
import { GENERATE_GOAL_PLAN_SYSTEM } from "../prompts/index.js";
import { personalizeSystem } from "../personalize.js";
import type { GenerateGoalPlanPayload } from "../payloads.js";

export async function handleGenerateGoalPlan(
  client: Anthropic,
  payload: GenerateGoalPlanPayload,
  memoryContext: string,
): Promise<unknown> {
  const { goalTitle, targetDate, importance, isHabit } = payload;
  const description = payload.description ?? "";

  // Research context injected by the coordinator
  const researchSummary = payload._researchSummary ?? "";
  const researchFindings = payload._researchFindings ?? [];

  const today = new Date().toISOString().split("T")[0];
  const startDate = (payload as unknown as Record<string, unknown>).startDate as string | undefined;
  const goalContext = [
    `- Goal: "${goalTitle}"`,
    `- Type: ${isHabit ? "Ongoing habit (no due date)" : "Goal with target date"}`,
    `- Start date: ${startDate || today}`,
    `- Target date: ${isHabit ? "N/A (habit)" : targetDate || "flexible"}`,
    `- Importance: ${importance}`,
    description ? `- User's description/context: "${description}"` : null,
    `- Today: ${today}`,
  ]
    .filter(Boolean)
    .join("\n");

  let researchBlock = "";
  if (researchSummary) {
    researchBlock = `\n\nRESEARCH DATA (use this to make the plan realistic):
${researchSummary}

KEY FINDINGS:
${researchFindings.map((f, i) => `${i + 1}. ${f}`).join("\n")}

IMPORTANT: Use the research data above to set REALISTIC timelines and milestones.
Do NOT ignore this data. If research says something takes 6 months, don't plan for 2 weeks.`;
  }

  // Methodology-layer block (Phase D/E). Each line only renders when the
  // corresponding field is present and non-empty, so the prompt stays
  // quiet for goals that don't carry methodology state yet.
  const methodologyLines: string[] = [];
  if (typeof payload._weeklyHoursTarget === "number" && payload._weeklyHoursTarget > 0) {
    methodologyLines.push(`- Weekly hours budget: ${payload._weeklyHoursTarget}h/week`);
  }
  if (payload._currentPhase) {
    methodologyLines.push(`- Current phase: ${payload._currentPhase}`);
  }
  const fm = payload._funnelMetrics;
  if (fm && typeof fm === "object" && Object.keys(fm).length > 0) {
    methodologyLines.push(`- Funnel metrics (JSON): ${JSON.stringify(fm)}`);
  }
  const sm = payload._skillMap;
  if (sm && typeof sm === "object" && Object.keys(sm).length > 0) {
    methodologyLines.push(`- T-shaped skill map (JSON): ${JSON.stringify(sm)}`);
  }
  const lm = payload._laborMarketData;
  if (lm && typeof lm === "object" && Object.keys(lm).length > 0) {
    methodologyLines.push(`- Labor-market data (JSON): ${JSON.stringify(lm)}`);
  }
  const ca = payload._clarificationAnswers;
  if (ca && typeof ca === "object" && Object.keys(ca).length > 0) {
    methodologyLines.push(`- Clarification answers (JSON): ${JSON.stringify(ca)}`);
  }
  const methodologyBlock =
    methodologyLines.length > 0
      ? `\n\nMETHODOLOGY INPUTS (use these to back-solve the plan shape):\n${methodologyLines.join("\n")}`
      : "";

  // Multi-month goals with year/month/week/day breakdown can output
  // 12K–25K tokens of JSON. The previous 16384 cap was being hit mid-
  // string for plans spanning ~5 months, producing "Unterminated string
  // in JSON at position N" parse errors that surfaced to the user as
  // a silent job:failed. Opus 4.6 supports 32K output natively.
  const response = await client.messages.create({
    model: getModelForTask("generate-goal-plan"),
    max_tokens: 32768,
    system: personalizeSystem(
      `${GENERATE_GOAL_PLAN_SYSTEM}\n\nGOAL CONTEXT:\n${goalContext}${researchBlock}${methodologyBlock}`,
      memoryContext,
    ),
    messages: [
      {
        role: "user",
        content: `Please create a comprehensive plan for my goal: "${goalTitle}"
Type: ${isHabit ? "Ongoing habit (no due date)" : "Goal with target date"}
Target date: ${isHabit ? "N/A (habit)" : targetDate || "flexible"}
Importance level: ${importance}${description ? `\nAdditional context: ${description}` : ""}${researchSummary ? `\n\nThe research agent found the following about this goal domain:\n${researchSummary}` : ""}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // Detect truncation vs other parse failures so the job error message
    // tells the user something actionable instead of leaking JS parser
    // internals. stop_reason === "max_tokens" means the model ran out of
    // headroom and the closing brackets/quotes never landed.
    const stopReason = (response as unknown as { stop_reason?: string }).stop_reason;
    const message = err instanceof Error ? err.message : String(err);
    if (stopReason === "max_tokens") {
      throw new Error(
        `Goal-plan generation hit the model's output limit (${cleaned.length} chars produced). ` +
        `Try a more focused goal or shorter timeframe.`,
      );
    }
    throw new Error(
      `Failed to parse goal-plan JSON: ${message}. Output length: ${cleaned.length} chars.`,
    );
  }
}
