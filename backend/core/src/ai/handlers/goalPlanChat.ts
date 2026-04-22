/* NorthStar — Goal Plan Chat handler */

import Anthropic from "@anthropic-ai/sdk";
import { getModelForTask } from "../../model-config.js";
import { GOAL_PLAN_CHAT_SYSTEM } from "../prompts/index.js";
import { personalizeSystem } from "../personalize.js";
import type { GoalPlanChatPayload } from "../payloads.js";

/** Build a compact summary of the current plan for the AI to reference.
 *  Only the first `bodyWeekBudget` unlocked weeks expand their day/task
 *  bodies; the rest are emitted as label-only skeleton rows. This keeps
 *  the prompt short on long-horizon plans where the AI only ever edits
 *  the near-term. */
function summarizePlanForChat(
  plan: Record<string, unknown>,
  bodyWeekBudget = 2,
): string {
  const milestones = (plan.milestones || []) as Array<Record<string, unknown>>;
  const years = (plan.years || []) as Array<Record<string, unknown>>;

  const lines: string[] = ["CURRENT PLAN STRUCTURE:"];

  if (milestones.length > 0) {
    lines.push("Milestones:");
    milestones.forEach((ms) => {
      lines.push(
        `  - [${ms.completed ? "✓" : " "}] ${ms.title} (target: ${ms.targetDate})`,
      );
    });
  }

  let unlockedBodiesEmitted = 0;

  for (const yr of years) {
    lines.push(`Year: ${yr.label} [id:${yr.id}] — ${yr.objective}`);
    const months = (yr.months || []) as Array<Record<string, unknown>>;
    for (const mo of months) {
      lines.push(`  ${mo.label} [id:${mo.id}]: ${mo.objective}`);
      const weeks = (mo.weeks || []) as Array<Record<string, unknown>>;
      for (const w of weeks) {
        const locked = w.locked as boolean;
        const days = (w.days || []) as Array<Record<string, unknown>>;
        const taskCount = days.reduce((sum: number, d) => {
          const tasks = (d.tasks || []) as Array<Record<string, unknown>>;
          return sum + tasks.length;
        }, 0);
        const completedCount = days.reduce((sum: number, d) => {
          const tasks = (d.tasks || []) as Array<Record<string, unknown>>;
          return sum + tasks.filter((t) => t.completed).length;
        }, 0);

        if (locked) {
          lines.push(
            `    🔒 ${w.label}: ${w.objective} (${completedCount}/${taskCount} tasks)`,
          );
          continue;
        }

        if (unlockedBodiesEmitted >= bodyWeekBudget) {
          lines.push(
            `    🔓 ${w.label} [id:${w.id}]: ${w.objective} (${completedCount}/${taskCount} tasks) — body omitted`,
          );
          continue;
        }

        lines.push(
          `    🔓 ${w.label} [id:${w.id}]: ${w.objective} (${completedCount}/${taskCount} tasks)`,
        );
        unlockedBodiesEmitted += 1;
        for (const d of days) {
          const day = d as Record<string, unknown>;
          const tasks = (day.tasks || []) as Array<Record<string, unknown>>;
          if (tasks.length > 0) {
            lines.push(`      ${day.label} [id:${day.id}]:`);
            for (const t of tasks) {
              const done = t.completed ? "✓" : " ";
              lines.push(
                `        [${done}] ${t.title} (${t.durationMinutes}min, ${t.priority}) [id:${t.id}]`,
              );
            }
          }
        }
      }
    }
  }

  return lines.join("\n");
}

/**
 * Shape returned by the goal-plan-chat LLM after JSON parsing. The reply
 * is always populated; plan/planPatch are set when the AI wants the
 * caller to mutate the plan tree.
 */
export interface GoalPlanChatResult {
  reply: string;
  planReady: boolean;
  plan: Record<string, unknown> | null;
  planPatch: Record<string, unknown> | null;
  /** True when the AI wants the server to dispatch a full replan via the
   *  dedicated goal plan generator (better quality than in-chat generation). */
  replan: boolean;
  /** ISO date the user confirmed for the new target, or null to keep current. */
  newTargetDate: string | null;
}

/**
 * Build the (system, messages, max_tokens, model) tuple for a goal-plan
 * chat request without actually sending it. Split out so the SSE
 * streaming route can reuse the exact same context/prompt construction
 * as the blocking handler.
 */
export function buildGoalPlanChatRequest(
  payload: GoalPlanChatPayload,
  memoryContext: string,
): {
  model: string;
  maxTokens: number;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const { goalTitle, targetDate, importance, isHabit, userMessage } = payload;
  const description = payload.description ?? "";
  const rawHistory = payload.chatHistory ?? [];
  // Trim history to the last 8 turns — full-session history isn't useful
  // for a plan-editing agent and blows out input tokens on long chats.
  const chatHistory = rawHistory.slice(-8);
  const currentPlan = payload.currentPlan ?? null;

  const messages: Array<{ role: "user" | "assistant"; content: string }> =
    chatHistory.map((m) => ({
      role: m.role as "user" | "assistant",
      // Sanitize history: strip JSON envelopes from old messages that
      // were persisted as raw JSON before the fix.
      content:
        m.role === "assistant" ? extractReplyFromText(m.content) : m.content,
    }));

  // chatHistory already contains the current userMessage as its last
  // entry (the client appends it). Only push a separate message if the
  // history is empty or doesn't end with the current userMessage.
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg || lastMsg.role !== "user" || lastMsg.content !== userMessage) {
    messages.push({ role: "user", content: userMessage });
  }

  const goalContext = [
    `- Goal: "${goalTitle}"`,
    `- Type: ${isHabit ? "Ongoing habit (no due date)" : "Goal with target date"}`,
    `- Target date: ${isHabit ? "N/A (habit)" : targetDate || "flexible"}`,
    `- Importance: ${importance}`,
    description ? `- User's description/context: "${description}"` : null,
    `- Today: ${new Date().toISOString().split("T")[0]}`,
  ]
    .filter(Boolean)
    .join("\n");

  const planBlock = currentPlan
    ? `\n\n${summarizePlanForChat(currentPlan)}`
    : "";

  return {
    model: getModelForTask("goal-plan-chat"),
    // Patches can legitimately span multiple days × multiple tasks when
    // the user asks to rewrite a whole week's workouts. 1536 caused
    // mid-stream truncation and raw-JSON leakage into the reply.
    maxTokens: 4096,
    system: personalizeSystem(
      `${GOAL_PLAN_CHAT_SYSTEM}\n\nGOAL CONTEXT:\n${goalContext}${planBlock}`,
      memoryContext,
    ),
    messages,
  };
}

/**
 * Try to extract a top-level JSON object from `text`, tolerating leading /
 * trailing prose, markdown fences, and truncated tails.  Returns the parsed
 * object or null.
 */
function tryExtractJson(text: string): Record<string, unknown> | null {
  // Strip markdown fences
  let cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  // 1) Fast path — the whole string is valid JSON
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
  } catch { /* continue */ }

  // 2) Find the first `{` and try progressively trimming from the end
  //    (handles truncated output from max_tokens).
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace < 0) return null;
  cleaned = cleaned.slice(firstBrace);

  // Try the full substring first, then chop trailing garbage character
  // by character (up to 200 chars) to recover from truncation.
  for (let trim = 0; trim <= Math.min(200, cleaned.length); trim++) {
    const candidate = trim === 0 ? cleaned : cleaned.slice(0, -trim);
    // Only try if it ends with `}` (or we add one)
    const tryStrings = candidate.endsWith("}")
      ? [candidate]
      : [`${candidate}}`];
    // Also try adding `}` in case truncated mid-field — crude but effective
    if (!candidate.endsWith("}")) tryStrings.push(`${candidate}"}`);

    for (const s of tryStrings) {
      try {
        const parsed = JSON.parse(s);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
          return parsed as Record<string, unknown>;
      } catch { /* next */ }
    }
  }
  return null;
}

/**
 * If `text` looks like a JSON envelope, extract just the "reply" string
 * value so we never show raw JSON to the user.  Falls back to the
 * original text if no JSON wrapper is detected.
 */
export function extractReplyFromText(text: string): string {
  // Quick check: does the text contain a JSON-like reply field?
  if (!text.includes('"reply"')) return text;

  const parsed = tryExtractJson(text);
  if (parsed && typeof parsed.reply === "string") return parsed.reply;

  // Last-ditch: regex extraction for the reply value
  const m = text.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (m) {
    return m[1]
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  return text;
}

/**
 * Parse a completed goal-plan-chat LLM reply into a structured result.
 * Shared between the blocking handler and the SSE streaming route so
 * both produce identical shapes.
 */
export function parseGoalPlanChatResult(text: string): GoalPlanChatResult {
  const parsed = tryExtractJson(text);

  if (parsed) {
    // Even when the JSON parsed, make sure `reply` is a string.
    // If the LLM omitted the field, fall back to extractReplyFromText
    // which will return the raw text (without JSON wrapper) as a
    // last resort — but never the raw JSON envelope.
    const reply = typeof parsed.reply === "string"
      ? parsed.reply
      : extractReplyFromText(text);

    return {
      reply,
      planReady: Boolean(parsed.planReady),
      plan:
        parsed.plan && typeof parsed.plan === "object"
          ? (parsed.plan as Record<string, unknown>)
          : null,
      planPatch:
        parsed.planPatch && typeof parsed.planPatch === "object"
          ? (parsed.planPatch as Record<string, unknown>)
          : null,
      replan: Boolean(parsed.replan),
      newTargetDate:
        typeof parsed.newTargetDate === "string" ? parsed.newTargetDate : null,
    };
  }

  // JSON extraction failed entirely — the LLM may have replied in
  // plain text (which is fine). Just make sure we strip any partial
  // JSON wrapper that might have leaked.
  return {
    reply: extractReplyFromText(text),
    planReady: false,
    plan: null,
    planPatch: null,
    replan: false,
    newTargetDate: null,
  };
}

export async function handleGoalPlanChat(
  client: Anthropic,
  payload: GoalPlanChatPayload,
  memoryContext: string,
): Promise<GoalPlanChatResult> {
  const request = buildGoalPlanChatRequest(payload, memoryContext);

  const response = await client.messages.create({
    model: request.model,
    max_tokens: request.maxTokens,
    system: request.system,
    messages: request.messages,
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  return parseGoalPlanChatResult(text);
}
