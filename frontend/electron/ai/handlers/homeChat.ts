/* NorthStar — Home Chat handler

   Owns LLM-output parsing, ID generation, defaulting, and eager job
   dispatch for intents detected in the reply. The renderer receives a
   fully-populated entity (with a server ID) and only dispatches it to
   the existing store setters — no client-side JSON parsing or
   business-rule branching.
*/

import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { getModelForTask } from "../../model-config";
import { HOME_CHAT_SYSTEM } from "../prompts";
import { personalizeSystem } from "../personalize";

// ── Result shapes ────────────────────────────────────────

export type HomeChatIntent =
  | { kind: "event"; entity: CalendarEventShape }
  | { kind: "goal"; entity: GoalShape; planJobId?: string }
  | { kind: "reminder"; entity: ReminderShape }
  | { kind: "task"; pendingTask: PendingTaskShape }
  | { kind: "manage-goal"; goalId: string; action: string; goalTitle: string }
  | { kind: "context-change"; suggestion: string };

export interface HomeChatResult {
  reply: string;
  intent: HomeChatIntent | null;
}

// These mirror the renderer's types (src/types/index.ts). We duplicate
// the shapes rather than import from the renderer because electron/ is
// a separate tsconfig project. Field names must stay in sync.
interface CalendarEventShape {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  isAllDay: boolean;
  durationMinutes: number;
  category: "work" | "personal" | "health" | "social" | "travel" | "focus" | "other";
  isVacation: boolean;
  source: "manual" | "device-calendar" | "device-reminders";
  notes?: string;
}

interface GoalShape {
  id: string;
  title: string;
  description: string;
  targetDate: string;
  isHabit: boolean;
  importance: "low" | "medium" | "high" | "critical";
  scope: "small" | "big";
  goalType: "big" | "everyday" | "repeating";
  status: "pending" | "planning" | "active" | "completed" | "archived";
  createdAt: string;
  updatedAt: string;
  planChat: never[];
  plan: null;
  flatPlan: null;
  planConfirmed: boolean;
  scopeReasoning: string;
  repeatSchedule: null;
}

interface ReminderShape {
  id: string;
  title: string;
  description: string;
  reminderTime: string;
  date: string;
  acknowledged: boolean;
  repeat: string | null;
  source: "chat";
  createdAt: string;
}

interface PendingTaskShape {
  id: string;
  userInput: string;
  analysis: null;
  status: "analyzing";
  createdAt: string;
}

// ── JSON extraction ──────────────────────────────────────

/** Pull a JSON object out of an LLM reply, tolerating code fences and
    surrounding prose. Returns null if no JSON is found or parsing fails.
    Ported verbatim from the old DashboardPage.tsx parser so behavior is
    byte-identical. */
function tryExtractJson(text: string): Record<string, unknown> | null {
  try {
    let jsonStr = text;
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
    if (!jsonStr.startsWith("{")) {
      const objMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (objMatch) jsonStr = objMatch[0];
    }
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export async function handleHomeChat(
  client: Anthropic,
  payload: Record<string, unknown>,
  memoryContext: string,
): Promise<HomeChatResult> {
  const userInput = payload.userInput as string;
  const chatHistory = (payload.chatHistory || []) as Array<{
    role: string;
    content: string;
  }>;
  const goals = (payload.goals || []) as Array<{
    title: string;
    scope: string;
    status: string;
    hasPlan?: boolean;
    planConfirmed?: boolean;
    subtaskCount?: number;
    visibleSubtaskCount?: number;
    unlockedWeekCount?: number;
    totalWeekCount?: number;
    milestoneCount?: number;
  }>;
  const todayTasks = (payload.todayTasks || []) as Array<{
    title: string;
    completed: boolean;
    cognitiveWeight?: number;
    durationMinutes?: number;
  }>;
  const todayCalendarEvents = (payload.todayCalendarEvents || []) as Array<{
    title: string;
    startDate: string;
    endDate: string;
    category: string;
  }>;

  const goalsSummary =
    goals.length > 0
      ? goals
          .map((g) => {
            const base = `- ${g.title} (${g.scope}, ${g.status})`;
            if (!g.hasPlan) return `${base} — no plan generated yet`;
            const visible = g.visibleSubtaskCount ?? 0;
            const total = g.subtaskCount ?? 0;
            const unlockedWeeks = g.unlockedWeekCount ?? 0;
            const totalWeeks = g.totalWeekCount ?? 0;
            const milestones = g.milestoneCount ?? 0;
            const confirmed = g.planConfirmed ? "confirmed" : "draft";
            return `${base} — plan ${confirmed}, ${visible}/${total} subtasks visible on tasks page (${unlockedWeeks}/${totalWeeks} weeks unlocked, ${milestones} milestones)`;
          })
          .join("\n")
      : "No goals set.";

  const tasksSummary =
    todayTasks.length > 0
      ? todayTasks
          .map(
            (t) =>
              `- [${t.completed ? "✓" : " "}] ${t.title} (weight: ${t.cognitiveWeight || 3}, ${t.durationMinutes || 30}min)`,
          )
          .join("\n")
      : "No tasks today.";

  const totalWeight = todayTasks.reduce(
    (sum, t) => sum + (t.cognitiveWeight || 3),
    0,
  );
  const totalMinutes = todayTasks.reduce(
    (sum, t) => sum + (t.durationMinutes || 30),
    0,
  );
  const completedCount = todayTasks.filter((t) => t.completed).length;
  const taskCount = todayTasks.filter((t) => !t.completed).length;

  const calendarSummary =
    todayCalendarEvents.length > 0
      ? todayCalendarEvents
          .map((e) => `- ${e.title} (${e.startDate}, ${e.category})`)
          .join("\n")
      : "No calendar events.";

  const environmentFormatted =
    (payload._environmentContextFormatted as string) || "";
  const environmentBlock = environmentFormatted
    ? `\n${environmentFormatted}\n`
    : "";

  const schedulingContextFormatted =
    (payload._schedulingContextFormatted as string) || "";
  const schedulingBlock = schedulingContextFormatted
    ? `\n${schedulingContextFormatted}\n`
    : "";

  const contextBlock = `USER CONTEXT:
${environmentBlock}${schedulingBlock}Goals:
${goalsSummary}

Today's tasks (${completedCount}/${todayTasks.length} done, ${taskCount} pending):
  Cognitive load: ${totalWeight}/12 points used
  Time committed: ${totalMinutes}/180 minutes used
  Active tasks: ${taskCount}/5 slots used
${tasksSummary}

Today's calendar:
${calendarSummary}`;

  const attachments = (payload.attachments || []) as Array<{
    type: string;
    name: string;
    base64: string;
    mediaType: string;
  }>;

  const messages = chatHistory.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  if (attachments.length > 0) {
    const contentBlocks: Array<
      | { type: "text"; text: string }
      | {
          type: "image";
          source: { type: "base64"; media_type: string; data: string };
        }
      | {
          type: "document";
          source: {
            type: "base64";
            media_type: "application/pdf";
            data: string;
          };
        }
    > = [];

    for (const att of attachments) {
      if (att.type === "image") {
        contentBlocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: att.mediaType,
            data: att.base64,
          },
        });
      } else if (att.type === "pdf") {
        contentBlocks.push({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: att.base64,
          },
        });
      }
    }

    contentBlocks.push({ type: "text", text: userInput });
    messages.push({
      role: "user",
      content: contentBlocks as unknown as string,
    });
  } else {
    messages.push({ role: "user", content: userInput });
  }

  const response = await client.messages.create({
    model: getModelForTask("home-chat"),
    max_tokens: 512,
    system: personalizeSystem(
      `${HOME_CHAT_SYSTEM}\n\n${contextBlock}`,
      memoryContext,
    ),
    messages,
  });

  const chatText =
    response.content[0].type === "text" ? response.content[0].text.trim() : "";

  // ── Intent detection ──────────────────────────────────
  // Try to extract a JSON object from the LLM reply. If present, build
  // the corresponding entity (with a server-assigned UUID) and return
  // both the raw reply text and a structured intent. The renderer uses
  // the intent to dispatch to existing store setters — it does no
  // parsing or ID generation of its own.

  const parsed = tryExtractJson(chatText);
  if (!parsed) {
    return { reply: chatText, intent: null };
  }

  const nowIso = () => new Date().toISOString();

  // ── Event ─────────────────────────────────────────────
  if (parsed.is_event) {
    const startDate = asString(parsed.startDate, nowIso());
    const endDate = asString(
      parsed.endDate,
      new Date(new Date(startDate).getTime() + 60 * 60 * 1000).toISOString(),
    );
    const durationMs = new Date(endDate).getTime() - new Date(startDate).getTime();
    const rawCategory = asString(parsed.category, "other");
    const allowedCategories = new Set([
      "work", "personal", "health", "social", "travel", "focus", "other",
    ]);
    const category = (allowedCategories.has(rawCategory)
      ? rawCategory
      : "other") as CalendarEventShape["category"];
    const event: CalendarEventShape = {
      id: randomUUID(),
      title: asString(parsed.title, userInput),
      startDate,
      endDate,
      isAllDay: Boolean(parsed.isAllDay),
      durationMinutes: Math.round(durationMs / 60000),
      category,
      isVacation: false,
      source: "manual",
      notes: typeof parsed.notes === "string" ? parsed.notes : undefined,
    };
    return { reply: chatText, intent: { kind: "event", entity: event } };
  }

  // ── Goal ──────────────────────────────────────────────
  if (parsed.is_goal) {
    const rawGoalType = asString(parsed.goalType, "big");
    const goalType: GoalShape["goalType"] =
      rawGoalType === "everyday" || rawGoalType === "repeating" || rawGoalType === "big"
        ? rawGoalType
        : "big";
    const rawImportance = asString(parsed.importance, "high");
    const importance: GoalShape["importance"] =
      rawImportance === "low" || rawImportance === "medium" ||
      rawImportance === "high" || rawImportance === "critical"
        ? rawImportance
        : "high";
    const goal: GoalShape = {
      id: randomUUID(),
      title: asString(parsed.title, userInput),
      description: asString(parsed.description),
      targetDate: asString(parsed.targetDate),
      isHabit: goalType === "everyday" || goalType === "repeating",
      importance,
      scope: goalType === "big" ? "big" : "small",
      goalType,
      status: "pending",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      planChat: [],
      plan: null,
      flatPlan: null,
      planConfirmed: false,
      scopeReasoning: "Created via home chat",
      repeatSchedule: null,
    };

    // Used to eagerly enqueue a generate-goal-plan job here against the
    // local SQLite job queue, but slice 6 deleted that queue. The renderer
    // now calls generateGoalPlan() directly when the user opens the goal,
    // which goes straight to the cloud backend via cloudInvoke.
    return {
      reply: chatText,
      intent: { kind: "goal", entity: goal },
    };
  }

  // ── Reminder ──────────────────────────────────────────
  if (parsed.is_reminder) {
    const today = nowIso().split("T")[0];
    const reminder: ReminderShape = {
      id: randomUUID(),
      title: asString(parsed.title, userInput),
      description: asString(parsed.description),
      reminderTime: asString(parsed.reminderTime, `${today}T09:00:00`),
      date: asString(parsed.date, today),
      acknowledged: false,
      repeat: typeof parsed.repeat === "string" ? parsed.repeat : null,
      source: "chat",
      createdAt: nowIso(),
    };
    return { reply: chatText, intent: { kind: "reminder", entity: reminder } };
  }

  // ── Quick Task ────────────────────────────────────────
  if (parsed.is_task) {
    const pendingTask: PendingTaskShape = {
      id: randomUUID(),
      userInput: asString(parsed.task_description, userInput),
      analysis: null,
      status: "analyzing",
      createdAt: nowIso(),
    };
    return { reply: chatText, intent: { kind: "task", pendingTask } };
  }

  // ── Manage Existing Goal ──────────────────────────────
  if (parsed.manage_goal) {
    return {
      reply: chatText,
      intent: {
        kind: "manage-goal",
        goalId: asString(parsed.goalId),
        action: asString(parsed.action),
        goalTitle: asString(parsed.goalTitle),
      },
    };
  }

  // ── Context Change ────────────────────────────────────
  if (parsed.context_change) {
    return {
      reply: chatText,
      intent: {
        kind: "context-change",
        suggestion: asString(parsed.suggestion),
      },
    };
  }

  // Parsed JSON but no recognized intent — treat as plain reply.
  return { reply: chatText, intent: null };
}
