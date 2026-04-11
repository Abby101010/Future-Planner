/* NorthStar — Goal Plan Chat handler */

import Anthropic from "@anthropic-ai/sdk";
import { getModelForTask } from "../../model-config";
import { GOAL_PLAN_CHAT_SYSTEM } from "../prompts";
import { personalizeSystem } from "../personalize";

/** Build a compact summary of the current plan for the AI to reference */
function summarizePlanForChat(plan: Record<string, unknown>): string {
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
            `    ${locked ? "🔒" : "🔓"} ${w.label}: ${w.objective} (${completedCount}/${taskCount} tasks)`,
          );
        } else {
          lines.push(
            `    🔓 ${w.label} [id:${w.id}]: ${w.objective} (${completedCount}/${taskCount} tasks)`,
          );
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
  }

  return lines.join("\n");
}

export async function handleGoalPlanChat(
  client: Anthropic,
  payload: Record<string, unknown>,
  memoryContext: string,
): Promise<unknown> {
  const goalTitle = payload.goalTitle as string;
  const targetDate = payload.targetDate as string;
  const importance = payload.importance as string;
  const isHabit = payload.isHabit as boolean;
  const description = (payload.description as string) || "";
  const chatHistory = (payload.chatHistory || []) as Array<{
    role: string;
    content: string;
  }>;
  const userMessage = payload.userMessage as string;
  const currentPlan = payload.currentPlan as Record<string, unknown> | null;

  const messages = chatHistory.map((m) => ({
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

  const response = await client.messages.create({
    model: getModelForTask("goal-plan-chat"),
    max_tokens: 4096,
    system: personalizeSystem(
      `${GOAL_PLAN_CHAT_SYSTEM}\n\nGOAL CONTEXT:\n${goalContext}${planBlock}`,
      memoryContext,
    ),
    messages,
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return { reply: text, planReady: false, plan: null, planPatch: null };
  }
}
