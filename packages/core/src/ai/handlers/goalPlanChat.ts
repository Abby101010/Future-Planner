/* NorthStar — Goal Plan Chat handler */

import Anthropic from "@anthropic-ai/sdk";
import { getModelForTask } from "../../model-config.js";
import { GOAL_PLAN_CHAT_SYSTEM } from "../prompts.js";
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
    lines.push(`Year: ${yr.label} — ${yr.objective}`);
    const months = (yr.months || []) as Array<Record<string, unknown>>;
    for (const mo of months) {
      lines.push(`  ${mo.label}: ${mo.objective}`);
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
      content: m.content,
    }));

  messages.push({ role: "user", content: userMessage });

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
 * Parse a completed goal-plan-chat LLM reply into a structured result.
 * Shared between the blocking handler and the SSE streaming route so
 * both produce identical shapes.
 */
export function parseGoalPlanChatResult(text: string): GoalPlanChatResult {
  const cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return {
      reply: typeof parsed.reply === "string" ? parsed.reply : text,
      planReady: Boolean(parsed.planReady),
      plan:
        parsed.plan && typeof parsed.plan === "object"
          ? (parsed.plan as Record<string, unknown>)
          : null,
      planPatch:
        parsed.planPatch && typeof parsed.planPatch === "object"
          ? (parsed.planPatch as Record<string, unknown>)
          : null,
    };
  } catch {
    return { reply: text, planReady: false, plan: null, planPatch: null };
  }
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
