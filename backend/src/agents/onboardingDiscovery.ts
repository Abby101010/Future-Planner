/* ──────────────────────────────────────────────────────────
   Starward — Onboarding Discovery Agent (Phase 3 flow step 3)

   Runs a single conversational turn during onboarding's opening
   conversation. Input: prior message history + the user's new
   message. Output: AI reply + structured extractions (facts /
   preferences / signals) + a `shouldConclude` flag.

   Retrieval: uses the clarification-patterns knowledge chunks so
   question phrasing adapts to the user's goal area without any
   hardcoded goal-type branching.

   Side effects: NONE. Persistence of messages + memory writes is
   the caller's (cmdSendOnboardingMessage) responsibility — this
   agent is a pure input→output function.
   ────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import type {
  FactCategory,
  SignalType,
} from "../memory";
import type { OnboardingMessage } from "@starward/core";
import { getClient } from "../ai/client";
import { getCurrentUserId } from "../middleware/requestContext";
import { getModelForTask } from "@starward/core";
import { loadMemory, buildMemoryContext } from "../memory";
import { ONBOARDING_DISCOVERY_SYSTEM } from "./prompts/onboardingDiscovery";

export interface OnboardingDiscoveryInput {
  priorMessages: OnboardingMessage[];
  userMessage: string;
}

export interface OnboardingFactExtraction {
  category: FactCategory;
  key: string;
  value: string;
  evidence: string;
}

export interface OnboardingPreferenceExtraction {
  text: string;
  tags: string[];
  example: string;
}

export interface OnboardingSignalExtraction {
  type: SignalType;
  context: string;
  value: string;
}

export interface OnboardingDiscoveryOutput {
  /** AI's reply to show in the chat. */
  reply: string;
  /** True when the AI thinks it has enough to hand off to the summarizer. */
  shouldConclude: boolean;
  /** Structured data the AI pulled from the user's latest message. */
  extractions: {
    facts: OnboardingFactExtraction[];
    preferences: OnboardingPreferenceExtraction[];
    signals: OnboardingSignalExtraction[];
  };
}

const FACT_CATEGORIES: readonly FactCategory[] = [
  "schedule",
  "preference",
  "capacity",
  "motivation",
  "pattern",
  "constraint",
  "strength",
  "struggle",
];

const SIGNAL_TYPES: readonly SignalType[] = [
  "task_completed",
  "task_snoozed",
  "task_skipped",
  "task_completed_early",
  "task_completed_late",
  "recovery_triggered",
  "blocker_reported",
  "schedule_override",
  "positive_feedback",
  "negative_feedback",
  "session_time",
  "high_energy_window",
  "low_energy_window",
  "chat_insight",
  "priority_feedback",
];

function fallbackReply(priorMessages: OnboardingMessage[]): OnboardingDiscoveryOutput {
  // Used when AI is unavailable — picks an opener or a neutral nudge.
  const isFirst = priorMessages.length === 0;
  const reply = isFirst
    ? "Before we start, I want to understand what's actually going on with you. Not a questionnaire — just a real conversation. What brought you here today?"
    : "Tell me a bit more about that — what's the part that's weighing on you most?";
  return {
    reply,
    shouldConclude: priorMessages.length >= 8,
    extractions: { facts: [], preferences: [], signals: [] },
  };
}

function parseResponse(text: string): OnboardingDiscoveryOutput {
  try {
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const reply = typeof parsed.reply === "string" && parsed.reply.trim()
      ? parsed.reply.trim()
      : "Got it. What else feels relevant right now?";
    const shouldConclude = parsed.shouldConclude === true;

    const rawExt = (parsed.extractions ?? {}) as {
      facts?: unknown;
      preferences?: unknown;
      signals?: unknown;
    };

    const facts: OnboardingFactExtraction[] = Array.isArray(rawExt.facts)
      ? rawExt.facts
          .map((f): OnboardingFactExtraction | null => {
            const fx = f as Partial<OnboardingFactExtraction>;
            if (!fx.category || !FACT_CATEGORIES.includes(fx.category as FactCategory)) return null;
            if (typeof fx.key !== "string" || !fx.key.trim()) return null;
            if (typeof fx.value !== "string" || !fx.value.trim()) return null;
            return {
              category: fx.category as FactCategory,
              key: fx.key.trim().slice(0, 80),
              value: fx.value.trim().slice(0, 200),
              evidence: (typeof fx.evidence === "string" ? fx.evidence.trim() : "").slice(0, 200),
            };
          })
          .filter((f): f is OnboardingFactExtraction => f !== null)
          .slice(0, 6)
      : [];

    const preferences: OnboardingPreferenceExtraction[] = Array.isArray(rawExt.preferences)
      ? rawExt.preferences
          .map((p): OnboardingPreferenceExtraction | null => {
            const px = p as Partial<OnboardingPreferenceExtraction>;
            if (typeof px.text !== "string" || !px.text.trim()) return null;
            const tags = Array.isArray(px.tags)
              ? (px.tags as unknown[])
                  .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
                  .map((t) => t.trim().toLowerCase())
                  .slice(0, 6)
              : [];
            return {
              text: px.text.trim().slice(0, 200),
              tags,
              example: (typeof px.example === "string" ? px.example.trim() : "").slice(0, 200),
            };
          })
          .filter((p): p is OnboardingPreferenceExtraction => p !== null)
          .slice(0, 4)
      : [];

    const signals: OnboardingSignalExtraction[] = Array.isArray(rawExt.signals)
      ? rawExt.signals
          .map((s): OnboardingSignalExtraction | null => {
            const sx = s as Partial<OnboardingSignalExtraction>;
            if (!sx.type || !SIGNAL_TYPES.includes(sx.type as SignalType)) return null;
            return {
              type: sx.type as SignalType,
              context: (typeof sx.context === "string" ? sx.context.trim() : "").slice(0, 200),
              value: (typeof sx.value === "string" ? sx.value.trim() : "").slice(0, 200),
            };
          })
          .filter((s): s is OnboardingSignalExtraction => s !== null)
          .slice(0, 4)
      : [];

    return {
      reply,
      shouldConclude,
      extractions: { facts, preferences, signals },
    };
  } catch {
    console.error("[onboarding-discovery] failed to parse AI response");
    return {
      reply: "Got it. Tell me a little more about that.",
      shouldConclude: false,
      extractions: { facts: [], preferences: [], signals: [] },
    };
  }
}

export async function runOnboardingDiscovery(
  input: OnboardingDiscoveryInput,
): Promise<OnboardingDiscoveryOutput> {
  // RAG context — pulls clarification-patterns + relevant methodology chunks.
  let memoryContext = "";
  try {
    const userId = getCurrentUserId();
    const memory = await loadMemory(userId);
    const retrievalQuery = `onboarding clarification patterns for goal message: ${input.userMessage.slice(0, 160)}`;
    memoryContext = await buildMemoryContext(memory, "planning", [], retrievalQuery);
  } catch (err) {
    console.error("[onboarding-discovery] memory/retrieval failed:", err);
  }

  const client = getClient();
  if (!client) return fallbackReply(input.priorMessages);

  // Turn the prior message list + new user message into the Claude
  // messages array. System prompt is constant; conversation state
  // lives in messages.
  const anthropicMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of input.priorMessages.slice(-10)) {
    anthropicMessages.push({ role: m.role, content: m.content });
  }
  anthropicMessages.push({ role: "user", content: input.userMessage });

  try {
    const systemPrompt = memoryContext
      ? `${ONBOARDING_DISCOVERY_SYSTEM}\n\n${memoryContext}`
      : ONBOARDING_DISCOVERY_SYSTEM;

    const response = await client.messages.create({
      model: getModelForTask("onboarding-discovery"),
      max_tokens: 1024,
      system: systemPrompt,
      messages: anthropicMessages,
    });
    const text = response.content
      .filter((b: Anthropic.ContentBlock): b is Anthropic.TextBlock => b.type === "text")
      .map((b: Anthropic.TextBlock) => b.text)
      .join("");
    return parseResponse(text);
  } catch (err) {
    console.error("[onboarding-discovery] AI call failed:", err);
    return fallbackReply(input.priorMessages);
  }
}
