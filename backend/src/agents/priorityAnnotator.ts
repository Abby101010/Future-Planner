/* ──────────────────────────────────────────────────────────
   NorthStar — Priority Annotator Sub-Agent (Phase B)

   Fills in cognitiveLoad / cognitiveCost / tier per task. Runs
   in parallel with gatekeeper; the scheduler uses these annotations
   to reorder within tier and to defer lowest-tier tasks when the
   user's dailyCognitiveBudget is exceeded.

   SKIPPABLE: if retrieval or the AI call fails, the agent returns
   an empty result. The scheduler must tolerate missing annotations
   and fall back to its current tier-1/tier-2/tier-3 ordering.

   Follows the Ruflo-inspired "selective RAG" pattern: pulls from
   psychology-principles + goal-setting knowledge files via a query
   built from task titles + goal context.
   ────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import { getClient } from "../ai/client";
import { getCurrentUserId } from "../middleware/requestContext";
import { getModelForTask, USER_SEGMENTS, type UserSegment } from "@northstar/core";
import { loadMemory, buildMemoryContext } from "../memory";
import { buildPriorityAnnotatorSystem } from "./prompts/priorityAnnotator";

const VALID_SEGMENT = new Set<string>(USER_SEGMENTS);

/** Map from segment to a short seed-term block prepended to the RAG query
 *  so pgvector pulls segment-relevant chunks. `general` contributes nothing. */
const SEGMENT_SEED_TERMS: Record<UserSegment, string> = {
  "career-transition": "job search psychology, deadline pressure, transformation goals",
  "freelancer": "context switching, deep work for creators, multi-project management",
  "side-project": "fragmented time, post-work cognitive depletion, habit formation",
  "general": "",
};

function resolveSegment(input?: UserSegment | string | null): UserSegment {
  if (input && VALID_SEGMENT.has(String(input))) return input as UserSegment;
  return "general";
}

export type CognitiveLoad = "high" | "medium" | "low";
export type Tier = "lifetime" | "quarter" | "week" | "day";

export interface PriorityAnnotatorTaskInput {
  id: string;
  title: string;
  description?: string;
  category?: string;
  goalId?: string | null;
  goalTitle?: string | null;
  goalType?: string | null;
}

export interface PriorityAnnotatorInput {
  tasks: PriorityAnnotatorTaskInput[];
  /** Optional free-text hint, e.g. "user is in recovery mode" — fed into the retrieval query. */
  contextHint?: string;
  /** Phase B: user segment — drives RAG seed terms + segment-specific
   *  guidance appended to the system prompt. Unknown / absent → "general"
   *  (byte-identical historical behaviour). */
  userSegment?: UserSegment | string | null;
}

export interface PriorityAnnotation {
  cognitiveLoad: CognitiveLoad;
  cognitiveCost: number;
  tier: Tier;
  rationale: string;
}

export interface PriorityAnnotatorOutput {
  annotations: Record<string, PriorityAnnotation>;
}

const VALID_LOAD = new Set<CognitiveLoad>(["high", "medium", "low"]);
const VALID_TIER = new Set<Tier>(["lifetime", "quarter", "week", "day"]);

function buildRetrievalQuery(
  input: PriorityAnnotatorInput,
  segment: UserSegment,
): string {
  const titles = input.tasks.map((t) => t.title).join(", ");
  const goalTitles = Array.from(
    new Set(input.tasks.map((t) => t.goalTitle).filter(Boolean) as string[]),
  ).join(", ");
  const segSeed = SEGMENT_SEED_TERMS[segment];
  const parts = [
    segSeed,
    "cognitive load dual-process System 1 System 2 value tiering goal importance for tasks:",
    titles,
    goalTitles ? `goals: ${goalTitles}` : "",
    input.contextHint ?? "",
  ];
  return parts.join(" ").trim().slice(0, 300);
}

function clampCost(n: unknown): number {
  if (typeof n !== "number" || Number.isNaN(n)) return 5;
  return Math.max(1, Math.min(10, Math.round(n)));
}

function parseResponse(
  text: string,
  tasks: PriorityAnnotatorTaskInput[],
): Record<string, PriorityAnnotation> {
  try {
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    const out: Record<string, PriorityAnnotation> = {};
    const raw = parsed.annotations && typeof parsed.annotations === "object"
      ? parsed.annotations as Record<string, Record<string, unknown>>
      : {};
    for (const t of tasks) {
      const r = raw[t.id];
      if (!r) continue;
      const load = VALID_LOAD.has(r.cognitiveLoad as CognitiveLoad)
        ? (r.cognitiveLoad as CognitiveLoad)
        : "medium";
      const cost = clampCost(r.cognitiveCost);
      const tier = VALID_TIER.has(r.tier as Tier) ? (r.tier as Tier) : "day";
      const rationale = typeof r.rationale === "string" ? r.rationale.slice(0, 200) : "";
      out[t.id] = { cognitiveLoad: load, cognitiveCost: cost, tier, rationale };
    }
    return out;
  } catch {
    console.error("[priority-annotator] failed to parse AI response");
    return {};
  }
}

export async function annotatePriorities(
  input: PriorityAnnotatorInput,
): Promise<PriorityAnnotatorOutput> {
  if (input.tasks.length === 0) return { annotations: {} };

  const userId = getCurrentUserId();
  const segment = resolveSegment(input.userSegment);
  const retrievalQuery = buildRetrievalQuery(input, segment);

  // Selective RAG: pull from psychology + goal-setting knowledge files.
  let memoryContext = "";
  try {
    const memory = await loadMemory(userId);
    memoryContext = await buildMemoryContext(memory, "daily", [], retrievalQuery);
  } catch (err) {
    console.error("[priority-annotator] memory/retrieval failed, proceeding without:", err);
  }

  const userMessage = `${memoryContext ? memoryContext + "\n\n" : ""}TASKS TO ANNOTATE:
${JSON.stringify(input.tasks, null, 2)}

Return the annotations JSON.`;

  const client = getClient();
  if (!client) {
    // Skippable: no client → no annotations; scheduler falls back.
    return { annotations: {} };
  }

  try {
    const response = await client.messages.create({
      model: getModelForTask("priority-annotator"),
      max_tokens: 2048,
      system: buildPriorityAnnotatorSystem(segment),
      messages: [{ role: "user", content: userMessage }],
    });
    const text = response.content
      .filter((b: Anthropic.ContentBlock): b is Anthropic.TextBlock => b.type === "text")
      .map((b: Anthropic.TextBlock) => b.text)
      .join("");
    return { annotations: parseResponse(text, input.tasks) };
  } catch (err) {
    console.error("[priority-annotator] AI call failed, returning empty annotations:", err);
    const { recordAgentFallback } = await import("../services/signalRecorder");
    recordAgentFallback("priority-annotator", err instanceof Error ? err.message : String(err)).catch(() => {});
    return { annotations: {} };
  }
}
