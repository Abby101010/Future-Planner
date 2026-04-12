/* ──────────────────────────────────────────────────────────
   NorthStar — Time Estimator Sub-Agent

   Calls Haiku to estimate realistic task durations with
   planning-fallacy correction, then checks whether the total
   exceeds the daily deep-work ceiling.
   ────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import { getClient } from "../ai/client";
import { emitAgentProgress } from "../ws";
import { getCurrentUserId } from "../middleware/requestContext";
import { getModelForTask, COGNITIVE_BUDGET } from "@northstar/core";
import type {
  TaskStateInput,
  TimeEstimatorResult,
  TimeEstimate,
  CandidateTask,
} from "@northstar/core";
import { TIME_ESTIMATOR_SYSTEM } from "./prompts/timeEstimator";

// ── Helpers ────────────────────────────────────────────────

/** Flatten all candidate tasks from goal summaries. */
function collectCandidates(input: TaskStateInput): CandidateTask[] {
  return input.goals.flatMap((g) => g.planTasksToday);
}

/** Build a completion-history summary string for the AI. */
function buildHistorySummary(input: TaskStateInput): string {
  if (input.pastLogs.length === 0) return "No completion history available (new user).";

  const recent = input.pastLogs.slice(-7);
  const totalCompleted = recent.reduce((s, l) => s + l.tasksCompleted, 0);
  const totalAssigned = recent.reduce((s, l) => s + l.tasksTotal, 0);
  const rate = totalAssigned > 0 ? Math.round((totalCompleted / totalAssigned) * 100) : -1;

  return `Last ${recent.length} days: ${totalCompleted}/${totalAssigned} tasks completed (${rate === -1 ? "no data" : rate + "%"} rate).`;
}

/** Default fallback estimate when AI is unavailable. */
function defaultEstimate(task: CandidateTask): TimeEstimate {
  const multiplier = 1.3;
  const adjusted = Math.round((task.durationMinutes * multiplier) / 5) * 5;
  return {
    originalMinutes: task.durationMinutes,
    adjustedMinutes: adjusted,
    confidence: "medium",
    bufferMinutes: 10,
  };
}

/** Parse AI JSON response safely. */
function parseAiResponse(
  text: string,
  candidates: CandidateTask[],
): Record<string, TimeEstimate> {
  try {
    const cleaned = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    const estimates: Record<string, TimeEstimate> = {};

    if (parsed.estimates && typeof parsed.estimates === "object") {
      for (const [id, est] of Object.entries(parsed.estimates)) {
        const e = est as Record<string, unknown>;
        estimates[id] = {
          originalMinutes: typeof e.originalMinutes === "number" ? e.originalMinutes : 30,
          adjustedMinutes: typeof e.adjustedMinutes === "number" ? e.adjustedMinutes : 40,
          confidence: (e.confidence === "low" || e.confidence === "medium" || e.confidence === "high")
            ? e.confidence
            : "medium",
          bufferMinutes: typeof e.bufferMinutes === "number" ? e.bufferMinutes : 10,
        };
      }
    }

    // Ensure every candidate has an estimate
    for (const c of candidates) {
      if (!estimates[c.id]) {
        estimates[c.id] = defaultEstimate(c);
      }
    }

    return estimates;
  } catch {
    console.error("[time-estimator] Failed to parse AI response, using defaults");
    const fallback: Record<string, TimeEstimate> = {};
    for (const c of candidates) {
      fallback[c.id] = defaultEstimate(c);
    }
    return fallback;
  }
}

// ── Main runner ────────────────────────────────────────────

export async function runTimeEstimator(input: TaskStateInput): Promise<TimeEstimatorResult> {
  const userId = getCurrentUserId();
  emitAgentProgress(userId, {
    agentId: "time-estimator",
    phase: "running",
    message: "Estimating task durations",
  });

  const candidates = collectCandidates(input);

  // If no candidates, return empty result
  if (candidates.length === 0) {
    emitAgentProgress(userId, { agentId: "time-estimator", phase: "done" });
    return {
      estimates: {},
      totalMinutes: 0,
      exceedsDeepWorkCeiling: false,
    };
  }

  const historySummary = buildHistorySummary(input);

  const userMessage = `Today is ${input.date}.

TASKS TO ESTIMATE:
${JSON.stringify(
  candidates.map((c) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    durationMinutes: c.durationMinutes,
    category: c.category,
    priority: c.priority,
  })),
  null,
  2,
)}

USER COMPLETION HISTORY:
${historySummary}
Recent completion rate: ${input.recentCompletionRate === -1 ? "no data (new user)" : `${input.recentCompletionRate}%`}

Estimate realistic durations for each task. Return JSON only.`;

  const client = getClient();
  let estimates: Record<string, TimeEstimate>;

  if (client) {
    try {
      const response = await client.messages.create({
        model: getModelForTask("time-estimator"),
        max_tokens: 2048,
        system: TIME_ESTIMATOR_SYSTEM,
        messages: [{ role: "user", content: userMessage }],
      });

      const text = response.content
        .filter((b: Anthropic.ContentBlock): b is Anthropic.TextBlock => b.type === "text")
        .map((b: Anthropic.TextBlock) => b.text)
        .join("");

      estimates = parseAiResponse(text, candidates);
    } catch (err) {
      console.error("[time-estimator] AI call failed, using default estimates:", err);
      estimates = {};
      for (const c of candidates) {
        estimates[c.id] = defaultEstimate(c);
      }
    }
  } else {
    // No client: use default estimates
    estimates = {};
    for (const c of candidates) {
      estimates[c.id] = defaultEstimate(c);
    }
  }

  // Compute totals
  const totalMinutes = Object.values(estimates).reduce(
    (sum, e) => sum + e.adjustedMinutes + e.bufferMinutes,
    0,
  );
  const exceedsDeepWorkCeiling = totalMinutes > COGNITIVE_BUDGET.MAX_DEEP_MINUTES;

  emitAgentProgress(userId, { agentId: "time-estimator", phase: "done" });

  return {
    estimates,
    totalMinutes,
    exceedsDeepWorkCeiling,
  };
}
