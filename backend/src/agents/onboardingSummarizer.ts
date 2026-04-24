/* ──────────────────────────────────────────────────────────
   Starward — Onboarding Summarizer Agent (Phase 3 flow step 4)

   After the discovery agent concludes the conversation, this agent
   reads the full message list + captured facts/preferences and
   proposes ONE goal for the user to start with. Not committed —
   cmdConfirmOnboardingGoal is what actually creates the Goal row.
   ────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import type {
  LongTermFact,
  SemanticPreference,
} from "../memory";
import type { OnboardingMessage, ProposedOnboardingGoal } from "@starward/core";
import { getClient } from "../ai/client";
import { getModelForTask } from "@starward/core";
import { ONBOARDING_SUMMARIZER_SYSTEM } from "./prompts/onboardingSummarizer";

export interface OnboardingSummarizerInput {
  messages: OnboardingMessage[];
  facts: LongTermFact[];
  preferences: SemanticPreference[];
}

export interface OnboardingSummarizerOutput {
  proposedGoal: ProposedOnboardingGoal;
}

function fallbackProposal(messages: OnboardingMessage[]): ProposedOnboardingGoal {
  // Extract the last substantive user message as a best-effort title.
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const title = (lastUser?.content ?? "A goal to start with").slice(0, 80);
  return {
    title,
    description: "Starting point captured from the opening conversation. Edit to refine.",
    targetDate: "",
    hoursPerWeek: 5,
    metadata: { area: "other" },
    rationale: "Fallback proposal — AI unavailable; using a conservative baseline.",
  };
}

function parseResponse(text: string, fallback: ProposedOnboardingGoal): ProposedOnboardingGoal {
  try {
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);
    const title = typeof parsed.title === "string" && parsed.title.trim()
      ? parsed.title.trim().slice(0, 120)
      : fallback.title;
    const description = typeof parsed.description === "string"
      ? parsed.description.trim().slice(0, 400)
      : fallback.description;
    const targetDate = typeof parsed.targetDate === "string"
      ? parsed.targetDate.trim()
      : "";
    const hoursPerWeekRaw = Number(parsed.hoursPerWeek);
    const hoursPerWeek = Number.isFinite(hoursPerWeekRaw) && hoursPerWeekRaw > 0
      ? Math.round(Math.min(80, Math.max(1, hoursPerWeekRaw)))
      : fallback.hoursPerWeek;
    const metadata = (parsed.metadata && typeof parsed.metadata === "object")
      ? (parsed.metadata as Record<string, unknown>)
      : fallback.metadata;
    const rationale = typeof parsed.rationale === "string"
      ? parsed.rationale.trim().slice(0, 240)
      : fallback.rationale;
    return { title, description, targetDate, hoursPerWeek, metadata, rationale };
  } catch {
    console.error("[onboarding-summarizer] failed to parse AI response, using fallback");
    return fallback;
  }
}

export async function proposeOnboardingGoal(
  input: OnboardingSummarizerInput,
): Promise<OnboardingSummarizerOutput> {
  const fallback = fallbackProposal(input.messages);
  const client = getClient();
  if (!client) return { proposedGoal: fallback };

  const userMessage = JSON.stringify(
    {
      conversation: input.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      facts: input.facts.map((f) => ({
        category: f.category,
        key: f.key,
        value: f.value,
      })),
      preferences: input.preferences.map((p) => ({
        text: p.text,
        tags: p.tags,
      })),
    },
    null,
    2,
  );

  try {
    const response = await client.messages.create({
      model: getModelForTask("onboarding-summarizer"),
      max_tokens: 1024,
      system: ONBOARDING_SUMMARIZER_SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    });
    const text = response.content
      .filter((b: Anthropic.ContentBlock): b is Anthropic.TextBlock => b.type === "text")
      .map((b: Anthropic.TextBlock) => b.text)
      .join("");
    return { proposedGoal: parseResponse(text, fallback) };
  } catch (err) {
    console.error("[onboarding-summarizer] AI call failed:", err);
    return { proposedGoal: fallback };
  }
}
