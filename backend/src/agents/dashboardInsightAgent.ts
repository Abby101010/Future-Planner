/* ──────────────────────────────────────────────────────────
   Starward — Dashboard Insight Agent (Phase 5)

   Given a specific goal (title, description, metadata, clarification
   answers), retrieves relevant methodology chunks via pgvector
   and returns a small set of InsightCard descriptors for the
   per-goal Dashboard to render.

   No hardcoded goal-type branching. Card selection emerges from
   what the retrieval surfaces.
   ────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import type { Goal, InsightCard } from "@starward/core";
import { getClient } from "../ai/client";
import { getCurrentUserId } from "../middleware/requestContext";
import { getModelForTask } from "@starward/core";
import { loadMemory, buildMemoryContext } from "../memory";
import { DASHBOARD_INSIGHT_SYSTEM } from "./prompts/dashboardInsight";

export interface DashboardInsightInput {
  goal: Goal;
  /** Extra hint (e.g. "new goal, just-planned" vs. "3 weeks in, falling behind"). */
  contextHint?: string;
}

export interface DashboardInsightOutput {
  cards: InsightCard[];
}

const ALLOWED_CARD_TYPES: readonly InsightCard["cardType"][] = [
  "progress-bar",
  "funnel",
  "streak",
  "checklist",
  "tracker-table",
  "heatmap",
  "phase-tracker",
  "countdown",
  "summary",
];

function buildRetrievalQuery(input: DashboardInsightInput): string {
  const { goal } = input;
  const parts = [
    "dashboard insights methodologies for goal:",
    goal.title,
    goal.goalDescription ?? "",
    goal.description ?? "",
    input.contextHint ?? "",
  ];
  return parts.join(" ").trim().slice(0, 300);
}

function fallbackCards(goal: Goal): InsightCard[] {
  // Minimal safe fallback when AI is unavailable or parse fails.
  // The universal template works even with just these generic cards.
  const cards: InsightCard[] = [
    {
      id: "c1",
      cardType: "progress-bar",
      title: "Overall progress",
      props: { label: "Completion", percent: goal.progressPercent ?? 0 },
    },
    {
      id: "c2",
      cardType: "summary",
      title: "Next step",
      props: { label: "Nothing to add yet", text: "The insight agent will fill this in when the knowledge base has something relevant." },
    },
  ];
  if (goal.targetDate) {
    cards.push({
      id: "c3",
      cardType: "countdown",
      title: "Time to target",
      props: {
        label: "Days remaining",
        targetDate: goal.targetDate,
        captionWhenReached: "Target date reached",
      },
    });
  }
  return cards;
}

function parseResponse(text: string, goal: Goal): InsightCard[] {
  try {
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.cards || !Array.isArray(parsed.cards)) return fallbackCards(goal);
    const out: InsightCard[] = [];
    for (let i = 0; i < parsed.cards.length && out.length < 5; i++) {
      const raw = parsed.cards[i] as {
        id?: unknown;
        cardType?: unknown;
        title?: unknown;
        props?: unknown;
      };
      if (typeof raw.cardType !== "string") continue;
      if (!ALLOWED_CARD_TYPES.includes(raw.cardType as InsightCard["cardType"])) continue;
      if (typeof raw.title !== "string" || !raw.title.trim()) continue;
      out.push({
        id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `c${i + 1}`,
        cardType: raw.cardType as InsightCard["cardType"],
        title: raw.title.trim().slice(0, 80),
        props: (raw.props && typeof raw.props === "object")
          ? (raw.props as Record<string, unknown>)
          : {},
      });
    }
    return out.length > 0 ? out : fallbackCards(goal);
  } catch {
    console.error("[dashboard-insight] failed to parse AI response, using fallback");
    return fallbackCards(goal);
  }
}

export async function generateInsightCards(
  input: DashboardInsightInput,
): Promise<DashboardInsightOutput> {
  const { goal } = input;

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
    console.error("[dashboard-insight] memory/retrieval failed, proceeding without:", err);
  }

  const goalSummary = {
    title: goal.title,
    goalDescription: goal.goalDescription ?? goal.description ?? "",
    targetDate: goal.targetDate,
    isHabit: goal.isHabit,
    goalType: goal.goalType,
    progressPercent: goal.progressPercent ?? 0,
    goalMetadata: goal.goalMetadata ?? {},
    clarificationAnswers: goal.clarificationAnswers ?? {},
  };

  const userMessage = `${memoryContext ? memoryContext + "\n\n" : ""}GOAL:
${JSON.stringify(goalSummary, null, 2)}

Return the insight cards JSON per the system prompt.`;

  const client = getClient();
  if (!client) return { cards: fallbackCards(goal) };

  try {
    const response = await client.messages.create({
      model: getModelForTask("dashboard-insight"),
      max_tokens: 1536,
      system: DASHBOARD_INSIGHT_SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    });
    const text = response.content
      .filter((b: Anthropic.ContentBlock): b is Anthropic.TextBlock => b.type === "text")
      .map((b: Anthropic.TextBlock) => b.text)
      .join("");
    return { cards: parseResponse(text, goal) };
  } catch (err) {
    console.error("[dashboard-insight] AI call failed:", err);
    return { cards: fallbackCards(goal) };
  }
}
