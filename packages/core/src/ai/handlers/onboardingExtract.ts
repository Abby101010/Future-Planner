/* NorthStar — Onboarding segment extraction pass (Phase B).
 *
 * One-shot Haiku call. Reads the full onboarding conversation plus the
 * user's raw goal and classifies them into a UserSegment. Runs once at
 * command:complete-onboarding time — never during the conversation
 * itself, so the conversational handler contract (plain text out) is
 * unchanged.
 *
 * Any failure — missing client, parse error, rate limit — resolves to
 * `{ userSegment: "general", confidence: 0, evidence: "" }`. Onboarding
 * must never be blocked by this call. */

import Anthropic from "@anthropic-ai/sdk";
import { getModelForTask } from "../../model-config.js";
import { USER_SEGMENTS, type UserSegment } from "../../types/index.js";

type ChatMessage = { role: string; content: string };

export interface OnboardingExtractInput {
  messages: ChatMessage[];
  goalRaw?: string;
}

export interface OnboardingExtractResult {
  userSegment: UserSegment;
  confidence: number;
  evidence: string;
}

const VALID = new Set<string>(USER_SEGMENTS);

const FALLBACK: OnboardingExtractResult = {
  userSegment: "general",
  confidence: 0,
  evidence: "",
};

const SYSTEM = `You classify a just-onboarded user into one of four segments
based on their conversation with a goal coach. You never see the user
directly — only the transcript.

Segments:
- "career-transition": leaving/changing a career; pursuing a new role,
  field, or identity. Signals: "quit my job to…", "pivot into…",
  "bootcamp", "switching careers", hard deadline tied to income runway.
- "freelancer": self-employed, runs multiple client/project streams.
  Signals: "contracts", "clients", "billable", "between projects",
  juggling deliverables, irregular weekly hours.
- "side-project": has a day job (or school) and works on this goal in
  spare hours. Signals: "after work", "on weekends", "when I get time",
  evenings-only focus, post-work depletion.
- "general": doesn't clearly fit any of the above, or signals are
  insufficient. Default when unsure.

Return STRICT JSON only, no prose, no markdown fences:

{
  "userSegment": "career-transition" | "freelancer" | "side-project" | "general",
  "confidence": 0..1,
  "evidence": "<short quote or paraphrase from the transcript, <=140 chars>"
}

Rules:
- If signals are weak or conflicting, return "general" with confidence <= 0.3.
- Do NOT infer from the goal topic alone (e.g. "learn Spanish" is not by
  itself career-transition). Require working-context evidence.
- Never return a segment not in the enum above.`;

export async function runOnboardingExtract(
  client: Anthropic | null,
  input: OnboardingExtractInput,
): Promise<OnboardingExtractResult> {
  if (!client) return FALLBACK;

  const transcript = input.messages
    .filter((m) => m.content && (m.role === "user" || m.role === "assistant"))
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

  if (!transcript.trim() && !input.goalRaw?.trim()) return FALLBACK;

  const userMessage = `RAW GOAL (initial input):
${input.goalRaw ?? "(none)"}

CONVERSATION TRANSCRIPT:
${transcript || "(no messages)"}

Classify this user. Return the JSON.`;

  try {
    const response = await client.messages.create({
      model: getModelForTask("onboarding"),
      max_tokens: 512,
      system: SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return parse(text);
  } catch (err) {
    console.error("[onboarding-extract] AI call failed, defaulting to general:", err);
    return FALLBACK;
  }
}

function parse(text: string): OnboardingExtractResult {
  try {
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const seg = typeof parsed.userSegment === "string" && VALID.has(parsed.userSegment)
      ? (parsed.userSegment as UserSegment)
      : "general";
    const rawConf = typeof parsed.confidence === "number" ? parsed.confidence : 0;
    const confidence = Math.max(0, Math.min(1, rawConf));
    const evidence = typeof parsed.evidence === "string" ? parsed.evidence.slice(0, 140) : "";
    return { userSegment: seg, confidence, evidence };
  } catch {
    return FALLBACK;
  }
}
