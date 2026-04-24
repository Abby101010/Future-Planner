/* ──────────────────────────────────────────────────────────
   Starward — Goal Clarifier Agent (Phase 3)

   Given a raw user-stated goal, retrieves relevant methodology
   chunks via pgvector RAG and asks Claude to produce a small
   set of high-leverage clarifying questions. The specific
   questions emerge from retrieval — there are no hardcoded
   goal-type branches.

   Called by goal-intake flows before generating a plan.
   ────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import { getClient } from "../ai/client";
import { getCurrentUserId } from "../middleware/requestContext";
import { getModelForTask } from "@starward/core";
import { loadMemory, buildMemoryContext } from "../memory";
import { GOAL_CLARIFIER_SYSTEM } from "./prompts/goalClarifier";

export interface GoalClarifierInput {
  /** The raw user-stated goal text (unprocessed). */
  rawGoalText: string;
  /** Optional extra context the caller already has (e.g. from onboarding). */
  contextHint?: string;
}

export interface ClarifyingQuestion {
  text: string;
  rationale: string;
}

export interface GoalClarifierOutput {
  questions: ClarifyingQuestion[];
}

function buildRetrievalQuery(input: GoalClarifierInput): string {
  const parts = [
    "clarification questions and methodology for goal:",
    input.rawGoalText,
    input.contextHint ?? "",
  ];
  return parts.join(" ").trim().slice(0, 300);
}

function fallbackQuestions(): ClarifyingQuestion[] {
  // Used if the AI client is missing or the call/parse fails. Generic
  // but high-leverage — matches the ordering from clarification-patterns.md.
  return [
    {
      text: "What would count as 'done' here — something measurable or observable?",
      rationale: "A plannable goal needs an outcome you could photograph or verify when hit.",
    },
    {
      text: "Do you have a deadline, even a soft one?",
      rationale: "Changes the entire plan shape; open-ended vs. dated plans are structured differently.",
    },
    {
      text: "Where are you right now relative to this goal — starting fresh, rusty, or already partway?",
      rationale: "Baseline determines ramp-up vs. execution pacing.",
    },
    {
      text: "How many hours per week can you realistically spend on this?",
      rationale: "Capacity is the strongest constraint on plan density; aspirational hours produce unmet plans.",
    },
  ];
}

function parseResponse(text: string): ClarifyingQuestion[] {
  try {
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.questions || !Array.isArray(parsed.questions)) return fallbackQuestions();
    const out: ClarifyingQuestion[] = [];
    for (const raw of parsed.questions) {
      const q = raw as { text?: unknown; rationale?: unknown };
      if (typeof q.text !== "string" || !q.text.trim()) continue;
      out.push({
        text: q.text.trim(),
        rationale: typeof q.rationale === "string" ? q.rationale.trim().slice(0, 200) : "",
      });
      if (out.length >= 6) break;
    }
    return out.length > 0 ? out : fallbackQuestions();
  } catch {
    console.error("[goal-clarifier] failed to parse AI response, using fallback");
    return fallbackQuestions();
  }
}

export async function clarifyGoal(
  input: GoalClarifierInput,
): Promise<GoalClarifierOutput> {
  const rawGoalText = input.rawGoalText?.trim();
  if (!rawGoalText) return { questions: fallbackQuestions() };

  let memoryContext = "";
  try {
    const userId = getCurrentUserId();
    const memory = await loadMemory(userId);
    memoryContext = await buildMemoryContext(
      memory,
      "planning",
      [],
      buildRetrievalQuery(input),
    );
  } catch (err) {
    console.error("[goal-clarifier] memory/retrieval failed, proceeding without:", err);
  }

  const userMessage = `${memoryContext ? memoryContext + "\n\n" : ""}USER'S RAW GOAL:
"${rawGoalText}"

Generate 3–6 high-leverage clarifying questions per the system prompt. Return JSON only.`;

  const client = getClient();
  if (!client) return { questions: fallbackQuestions() };

  try {
    const response = await client.messages.create({
      model: getModelForTask("goal-clarifier"),
      max_tokens: 1024,
      system: GOAL_CLARIFIER_SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    });
    const text = response.content
      .filter((b: Anthropic.ContentBlock): b is Anthropic.TextBlock => b.type === "text")
      .map((b: Anthropic.TextBlock) => b.text)
      .join("");
    return { questions: parseResponse(text) };
  } catch (err) {
    console.error("[goal-clarifier] AI call failed:", err);
    return { questions: fallbackQuestions() };
  }
}
