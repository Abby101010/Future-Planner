/* ──────────────────────────────────────────────────────────
   NorthStar — Duration Estimator Sub-Agent (Phase A)

   First production caller of retrieveRelevant (via the
   retrievalQuery parameter wired into buildMemoryContext in
   Phase 1). Takes a batch of tasks, returns per-task minute
   estimates grounded in retrieved time-estimation principles.
   ────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import { getClient } from "../ai/client";
import { getCurrentUserId } from "../middleware/requestContext";
import { getModelForTask } from "@northstar/core";
import { loadMemory, buildMemoryContext } from "../memory";
import { DURATION_ESTIMATOR_SYSTEM } from "./prompts/durationEstimator";

export interface DurationEstimatorTaskInput {
  id: string;
  title: string;
  description?: string;
  category?: string;
}

export interface DurationEstimatorInput {
  tasks: DurationEstimatorTaskInput[];
  contextHint?: string;
}

export interface DurationEstimate {
  minutes: number;
  confidence: "low" | "medium" | "high";
  rationale: string;
}

export interface DurationEstimatorOutput {
  estimates: Record<string, DurationEstimate>;
}

function buildRetrievalQuery(input: DurationEstimatorInput): string {
  const titles = input.tasks.map((t) => t.title).join(", ");
  const parts = [
    "time estimation planning fallacy for tasks:",
    titles,
    input.contextHint ?? "",
  ];
  return parts.join(" ").trim().slice(0, 300);
}

function defaultEstimate(task: DurationEstimatorTaskInput): DurationEstimate {
  return {
    minutes: 30,
    confidence: "low",
    rationale: "Fallback estimate — AI client unavailable.",
  };
}

function parseResponse(
  text: string,
  tasks: DurationEstimatorTaskInput[],
): Record<string, DurationEstimate> {
  try {
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    const estimates: Record<string, DurationEstimate> = {};
    if (parsed.estimates && typeof parsed.estimates === "object") {
      for (const [id, est] of Object.entries(parsed.estimates)) {
        const e = est as Record<string, unknown>;
        const minutes = typeof e.minutes === "number" ? Math.max(1, Math.min(480, Math.round(e.minutes / 5) * 5)) : 30;
        const confidence = e.confidence === "low" || e.confidence === "medium" || e.confidence === "high" ? e.confidence : "medium";
        const rationale = typeof e.rationale === "string" ? e.rationale : "";
        estimates[id] = { minutes, confidence, rationale };
      }
    }
    for (const t of tasks) {
      if (!estimates[t.id]) estimates[t.id] = defaultEstimate(t);
    }
    return estimates;
  } catch {
    console.error("[duration-estimator] failed to parse AI response, using defaults");
    const fallback: Record<string, DurationEstimate> = {};
    for (const t of tasks) fallback[t.id] = defaultEstimate(t);
    return fallback;
  }
}

export async function estimateDurations(
  input: DurationEstimatorInput,
): Promise<DurationEstimatorOutput> {
  if (input.tasks.length === 0) return { estimates: {} };

  const userId = getCurrentUserId();
  const retrievalQuery = buildRetrievalQuery(input);

  // ── First production caller of the Phase 1 retrieval wiring ──
  let memoryContext = "";
  try {
    const memory = await loadMemory(userId);
    memoryContext = await buildMemoryContext(memory, "daily", [], retrievalQuery);
  } catch (err) {
    console.error("[duration-estimator] memory/retrieval failed, proceeding without:", err);
  }

  const userMessage = `${memoryContext ? memoryContext + "\n\n" : ""}TASKS TO ESTIMATE:
${JSON.stringify(input.tasks, null, 2)}

Return the estimates JSON.`;

  const client = getClient();
  if (!client) {
    const estimates: Record<string, DurationEstimate> = {};
    for (const t of input.tasks) estimates[t.id] = defaultEstimate(t);
    return { estimates };
  }

  try {
    const response = await client.messages.create({
      model: getModelForTask("duration-estimator"),
      max_tokens: 2048,
      system: DURATION_ESTIMATOR_SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    });
    const text = response.content
      .filter((b: Anthropic.ContentBlock): b is Anthropic.TextBlock => b.type === "text")
      .map((b: Anthropic.TextBlock) => b.text)
      .join("");
    return { estimates: parseResponse(text, input.tasks) };
  } catch (err) {
    console.error("[duration-estimator] AI call failed:", err);
    const estimates: Record<string, DurationEstimate> = {};
    for (const t of input.tasks) estimates[t.id] = defaultEstimate(t);
    return { estimates };
  }
}
