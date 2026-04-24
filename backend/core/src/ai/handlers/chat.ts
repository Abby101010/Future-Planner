/* Starward — Unified chat handler
 *
 * Combines homeChat and goalPlanChat into a single context-aware handler.
 * The response format depends on context.currentPage:
 *   - "goal-plan": expects JSON envelope {reply, planReady, plan, planPatch}
 *   - everything else: expects prose with optional JSON intent blocks
 *
 * Both old handlers (handleHomeChat, handleGoalPlanChat) remain functional
 * for backward compatibility; new code should use handleUnifiedChat.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getModelForTask } from "../../model-config.js";
import { buildUnifiedChatPrompt } from "../prompts/chat.js";
import { personalizeSystem } from "../personalize.js";
import type { UnifiedChatPayload } from "../payloads.js";

import {
  parseHomeChatIntents,
  stripJsonBlocks,
  type HomeChatIntent,
} from "./homeChat.js";
import {
  parseGoalPlanChatResult,
  type GoalPlanChatResult,
} from "./goalPlanChat.js";

// ── Result shape ────────────────────────────────────────────

export interface UnifiedChatResult {
  reply: string;
  intent: HomeChatIntent | null;
  intents: HomeChatIntent[];
  planReady: boolean;
  plan: Record<string, unknown> | null;
  planPatch: Record<string, unknown> | null;
  /** True when the AI wants the server to dispatch a full replan via the
   *  dedicated goal plan generator. */
  replan: boolean;
  /** ISO date the user confirmed for the new target, or null to keep current. */
  newTargetDate: string | null;
}

// ── Plan summary builder (lifted from goalPlanChat.ts) ──────

function summarizePlanForChat(
  plan: Record<string, unknown>,
  bodyWeekBudget = 8,
): string {
  const milestones = (plan.milestones || []) as Array<Record<string, unknown>>;
  const years = (plan.years || []) as Array<Record<string, unknown>>;
  const lines: string[] = ["CURRENT PLAN STRUCTURE:"];

  if (milestones.length > 0) {
    lines.push("Milestones:");
    milestones.forEach((ms) => {
      lines.push(
        `  - [${ms.completed ? "\u2713" : " "}] ${ms.title} (target: ${ms.targetDate})`,
      );
    });
  }

  let unlockedBodiesEmitted = 0;
  for (const yr of years) {
    lines.push(`Year: ${yr.label} [id:${yr.id}] \u2014 ${yr.objective}`);
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
            `    \ud83d\udd12 ${w.label}: ${w.objective} (${completedCount}/${taskCount} tasks)`,
          );
          continue;
        }
        if (unlockedBodiesEmitted >= bodyWeekBudget) {
          lines.push(
            `    \ud83d\udd13 ${w.label} [id:${w.id}]: ${w.objective} (${completedCount}/${taskCount} tasks) \u2014 body omitted`,
          );
          continue;
        }
        lines.push(
          `    \ud83d\udd13 ${w.label} [id:${w.id}]: ${w.objective} (${completedCount}/${taskCount} tasks)`,
        );
        unlockedBodiesEmitted += 1;
        for (const d of days) {
          const day = d as Record<string, unknown>;
          const tasks = (day.tasks || []) as Array<Record<string, unknown>>;
          if (tasks.length > 0) {
            lines.push(`      ${day.label} [id:${day.id}]:`);
            for (const t of tasks) {
              const done = t.completed ? "\u2713" : " ";
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

// ── Context block builders ──────────────────────────────────

function buildGoalsContext(
  goals: Array<Record<string, unknown>>,
): string {
  if (goals.length === 0) return "No goals set.";
  return goals
    .map((g) => {
      const base = `- ${g.title} (${g.scope}, ${g.status})`;
      if (!g.hasPlan) return `${base} \u2014 no plan generated yet`;
      const visible = (g.visibleSubtaskCount ?? 0) as number;
      const total = (g.subtaskCount ?? 0) as number;
      const unlockedWeeks = (g.unlockedWeekCount ?? 0) as number;
      const totalWeeks = (g.totalWeekCount ?? 0) as number;
      const milestones = (g.milestoneCount ?? 0) as number;
      const confirmed = g.planConfirmed ? "confirmed" : "draft";
      return `${base} \u2014 plan ${confirmed}, ${visible}/${total} subtasks visible on tasks page (${unlockedWeeks}/${totalWeeks} weeks unlocked, ${milestones} milestones)`;
    })
    .join("\n");
}

function buildTasksContext(
  todayTasks: Array<Record<string, unknown>>,
): { summary: string; totalWeight: number; totalMinutes: number; completedCount: number; taskCount: number } {
  const totalWeight = todayTasks.reduce(
    (sum, t) => sum + ((t.cognitiveWeight as number) || 3),
    0,
  );
  const totalMinutes = todayTasks.reduce(
    (sum, t) => sum + ((t.durationMinutes as number) || 30),
    0,
  );
  const completedCount = todayTasks.filter((t) => t.completed).length;
  const taskCount = todayTasks.filter((t) => !t.completed).length;

  const summary =
    todayTasks.length > 0
      ? todayTasks
          .map(
            (t) =>
              `- [${t.completed ? "\u2713" : t.skipped ? "S" : " "}] "${t.title}" [taskId:${t.id}] (weight: ${(t.cognitiveWeight as number) || 3}, ${(t.durationMinutes as number) || 30}min)`,
          )
          .join("\n")
      : "No tasks today.";

  return { summary, totalWeight, totalMinutes, completedCount, taskCount };
}


function buildRemindersContext(
  reminders: Array<Record<string, unknown>>,
): string {
  if (reminders.length === 0) return "No active reminders.";
  return reminders
    .map((r) => {
      const time = (r.reminderTime ?? r.date ?? "no time set") as string;
      const repeat = r.repeat && r.repeat !== "none" ? `, repeats ${r.repeat}` : "";
      const ack = r.acknowledged ? " [acknowledged]" : "";
      const desc = r.description ? ` \u2014 ${r.description}` : "";
      return `- "${r.title}"${desc} (${time}${repeat})${ack} [reminderId:${r.id}]`;
    })
    .join("\n");
}

// ── Request builder ─────────────────────────────────────────

export function buildUnifiedChatRequest(
  payload: UnifiedChatPayload,
  memoryContext: string,
): {
  model: string;
  maxTokens: number;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
  mode: "general" | "plan-edit";
} {
  const { userInput, context } = payload;
  const chatHistory = payload.chatHistory ?? [];
  const goals = (payload.goals ?? []) as Array<Record<string, unknown>>;
  const todayTasks = (payload.todayTasks ?? []) as Array<Record<string, unknown>>;
  const activeReminders = (payload.activeReminders ?? []) as Array<Record<string, unknown>>;

  const mode = context?.currentPage === "goal-plan" ? "plan-edit" as const : "general" as const;

  const systemPrompt = buildUnifiedChatPrompt({
    currentPage: context?.currentPage ?? "tasks",
    weeklyReviewDue: context?.weeklyReviewDue,
  });

  // Build context block
  const goalsSummary = buildGoalsContext(goals);
  const tasksCtx = buildTasksContext(todayTasks);
  const remindersSummary = buildRemindersContext(activeReminders);

  const environmentBlock = payload._environmentContextFormatted
    ? `\n${payload._environmentContextFormatted}\n`
    : "";
  const schedulingBlock = payload._schedulingContextFormatted
    ? `\n${payload._schedulingContextFormatted}\n`
    : "";

  const todayLine = `Today: ${payload.todayDate ?? new Date().toISOString().split("T")[0]}`;

  let contextBlock = `USER CONTEXT:
${todayLine}
${environmentBlock}${schedulingBlock}Goals:
${goalsSummary}

Today's tasks (${tasksCtx.completedCount}/${todayTasks.length} done, ${tasksCtx.taskCount} pending):
  Cognitive load: ${tasksCtx.totalWeight}/12 points used
  Time committed: ${tasksCtx.totalMinutes}/180 minutes used
  Active tasks: ${tasksCtx.taskCount}/5 slots used
${tasksCtx.summary}

Active reminders:
${remindersSummary}`;

  // Goal plan context (when on goal-plan page)
  if (mode === "plan-edit" && context) {
    const goalContext = [
      context.goalTitle ? `- Goal: "${context.goalTitle}"` : null,
      `- Type: ${context.isHabit ? "Ongoing habit (no due date)" : "Goal with target date"}`,
      `- Target date: ${context.isHabit ? "N/A (habit)" : context.targetDate || "flexible"}`,
      context.importance ? `- Importance: ${context.importance}` : null,
      context.description ? `- User's description/context: "${context.description}"` : null,
      `- Today: ${payload.todayDate ?? new Date().toISOString().split("T")[0]}`,
    ]
      .filter(Boolean)
      .join("\n");

    const planBlock = context.selectedGoalPlan
      ? `\n\n${summarizePlanForChat(context.selectedGoalPlan)}`
      : "";

    contextBlock += `\n\nGOAL CONTEXT:\n${goalContext}${planBlock}`;

    // Overload advisory — user has too many goals for their capacity
    const advisory = context.overloadAdvisory as Record<string, unknown> | null | undefined;
    if (advisory) {
      contextBlock += `\n\nOVERLOAD ADVISORY (user has too many active goals for their daily capacity):
- Total active goals: ${advisory.totalActiveGoals}
- This goal's importance: ${advisory.goalImportance}
- This goal's fair share of daily capacity: ~${advisory.suggestedTasksPerDay} tasks/day (${advisory.suggestedFreqLabel})
- Remaining tasks in this plan: ${advisory.remainingTasks}
- Current target date: ${advisory.currentTargetDate ?? "none"}
- Suggested new target date: ${advisory.suggestedTargetDate}

IMPORTANT: The user is asking about adjusting this goal because they're overloaded.
1. Explain that they have ${advisory.totalActiveGoals} active goals competing for limited daily capacity
2. Suggest reducing this goal to ${advisory.suggestedFreqLabel} frequency
3. Explain this would extend the deadline to ${advisory.suggestedTargetDate}
4. Ask for their confirmation before making changes
5. When they confirm, output a COMPLETE modified plan with the reduced frequency — spread remaining tasks across more days with each day having at most ${advisory.suggestedTasksPerDay} tasks for this goal
6. Set planReady: true with the full adjusted plan`;
    }
  }

  // Weekly review context
  if (context?.weeklyReviewDue && context.activeGoals) {
    const goalsList = (context.activeGoals as Array<Record<string, unknown>>)
      .map((g) => `- ${g.title}`)
      .join("\n");
    contextBlock += `\n\nWEEKLY REVIEW DATA:\nAll goals:\n${goalsList}`;
  }

  const fullSystem = personalizeSystem(
    `${systemPrompt}\n\n${contextBlock}`,
    memoryContext,
  );

  // Build messages
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> =
    chatHistory.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  // Handle attachments (images, PDFs)
  const attachments = (payload.attachments ?? []) as Array<{
    type: string;
    name: string;
    base64: string;
    mediaType: string;
  }>;

  if (attachments.length > 0) {
    const contentBlocks: Array<
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
      | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } }
    > = [];

    for (const att of attachments) {
      if (att.type === "image") {
        contentBlocks.push({
          type: "image",
          source: { type: "base64", media_type: att.mediaType, data: att.base64 },
        });
      } else if (att.type === "pdf") {
        contentBlocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: att.base64 },
        });
      }
    }
    contentBlocks.push({ type: "text", text: userInput });
    messages.push({ role: "user", content: contentBlocks });
  } else {
    messages.push({ role: "user", content: userInput });
  }

  // Plan-edit mode needs room for full plan JSON (milestones + years +
  // months + 2 weeks of daily tasks). 4096 caused truncation on complex
  // goals — match the dedicated generate-goal-plan handler's 8192.
  const maxTokens = mode === "plan-edit" ? 8192 : 512;
  const modelTask = mode === "plan-edit" ? "goal-plan-chat" : "home-chat";

  return {
    model: getModelForTask(modelTask),
    maxTokens,
    system: fullSystem,
    messages,
    mode,
  };
}

// ── Response parser ─────────────────────────────────────────

export function parseUnifiedChatResult(
  text: string,
  mode: "general" | "plan-edit",
  userInput: string,
  todayDate?: string,
): UnifiedChatResult {
  if (mode === "plan-edit") {
    const planResult = parseGoalPlanChatResult(text);
    // Safety: strip any JSON that leaked into the reply text.
    const cleanReply = stripJsonBlocks(planResult.reply);
    return {
      reply: cleanReply || planResult.reply,
      intent: null,
      intents: [],
      planReady: planResult.planReady,
      plan: planResult.plan,
      planPatch: planResult.planPatch,
      replan: planResult.replan,
      newTargetDate: planResult.newTargetDate,
    };
  }

  const trimmed = text.trim();
  const intents = parseHomeChatIntents(trimmed, userInput, todayDate);
  const intent = intents.length > 0 ? intents[0] : null;
  const stripped = stripJsonBlocks(trimmed);
  const reply =
    stripped.length > 0
      ? stripped
      : intents.length > 0
        ? ""
        : trimmed;

  return {
    reply,
    intent,
    intents,
    planReady: false,
    plan: null,
    planPatch: null,
    replan: false,
    newTargetDate: null,
  };
}

// ── Main handler ────────────────────────────────────────────

export async function handleUnifiedChat(
  client: Anthropic,
  payload: UnifiedChatPayload,
  memoryContext: string,
): Promise<UnifiedChatResult> {
  const request = buildUnifiedChatRequest(payload, memoryContext);

  const response = await client.messages.create({
    model: request.model,
    max_tokens: request.maxTokens,
    system: request.system,
    messages: request.messages as Parameters<
      typeof client.messages.create
    >[0]["messages"],
  });

  const chatText =
    response.content[0].type === "text" ? response.content[0].text.trim() : "";

  return parseUnifiedChatResult(
    chatText,
    request.mode,
    payload.userInput,
    payload.todayDate,
  );
}
