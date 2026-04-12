/* NorthStar — Home Chat handler

   Owns LLM-output parsing, ID generation, defaulting, and eager job
   dispatch for intents detected in the reply. The renderer receives a
   fully-populated entity (with a server ID) and only dispatches it to
   the existing store setters — no client-side JSON parsing or
   business-rule branching.
*/

import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { getModelForTask } from "../../model-config.js";
import { HOME_CHAT_SYSTEM } from "../prompts.js";
import { personalizeSystem } from "../personalize.js";
import type { HomeChatPayload } from "../payloads.js";

// ── Result shapes ────────────────────────────────────────

export type HomeChatIntent =
  | { kind: "event"; entity: CalendarEventShape }
  | { kind: "goal"; entity: GoalShape; planJobId?: string }
  | { kind: "reminder"; entity: ReminderShape }
  | { kind: "task"; pendingTask: PendingTaskShape }
  | { kind: "manage-goal"; goalId: string; action: string; goalTitle: string }
  | { kind: "manage-task"; taskId: string; action: "complete" | "skip" | "reschedule"; taskTitle: string; rescheduleDate?: string }
  | { kind: "context-change"; suggestion: string }
  | { kind: "research"; topic: string; relatedGoalId: string };

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

/** Pull a JSON object out of an LLM reply. Tries three strategies in
    order: clean parse, markdown code fence, greedy brace extraction.
    Returns null and logs the raw text if all strategies fail so we can
    debug what the LLM actually returned. */
interface JsonSpan {
  start: number;
  end: number;
  text: string;
}

/** Scan `text` for all top-level balanced-brace spans. Respects JSON
 *  string escaping so `{ "a": "}" }` counts as one span. Does not
 *  validate the contents — callers can try JSON.parse on each. */
function findBalancedJsonObjects(text: string): JsonSpan[] {
  const out: JsonSpan[] = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("{", i);
    if (start === -1) break;
    let depth = 0;
    let inString = false;
    let escape = false;
    let end = -1;
    for (let j = start; j < text.length; j++) {
      const ch = text[j];
      if (inString) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end === -1) break;
    out.push({ start, end, text: text.slice(start, end + 1) });
    i = end + 1;
  }
  return out;
}

/** Remove any valid JSON object literals — including markdown-fenced
 *  blocks — from the chat reply, leaving the conversational prose.
 *  Used as a safety net so raw JSON can never leak into the rendered
 *  message even if the LLM mixes multiple intents with commentary. */
export function stripJsonBlocks(text: string): string {
  let out = text.replace(/```(?:json)?\s*\n?[\s\S]*?\n?```/g, "");
  const spans = findBalancedJsonObjects(out).filter((s) => {
    try {
      const parsed = JSON.parse(s.text);
      return typeof parsed === "object" && parsed !== null;
    } catch {
      return false;
    }
  });
  for (let k = spans.length - 1; k >= 0; k--) {
    out = out.slice(0, spans[k].start) + out.slice(spans[k].end + 1);
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

function tryExtractJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();

  // 1. Clean JSON?
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* fall through */
  }

  // 2. Markdown code fence — ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* fall through */
    }
  }

  // 3. Walk every balanced-brace span and return the first one that
  //    parses as a JSON object. This handles the multi-intent case
  //    where the LLM emits several JSON blocks interleaved with prose
  //    — the old "first { to last }" greedy approach would try to
  //    parse the prose too and fail.
  for (const span of findBalancedJsonObjects(trimmed)) {
    try {
      const parsed = JSON.parse(span.text);
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* try next span */
    }
  }

  console.warn(
    "[ai:homeChat:json] failed to extract JSON from LLM response:",
    trimmed.slice(0, 500),
  );
  return null;
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/**
 * Build the (system, messages, max_tokens, model) tuple for a home-chat
 * request without actually sending it. Split out from handleHomeChat so
 * the SSE streaming route can reuse the exact same context/prompt/message
 * construction and then pipe tokens back to the client as they arrive.
 */
export function buildHomeChatRequest(
  payload: HomeChatPayload,
  memoryContext: string,
): {
  model: string;
  maxTokens: number;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
} {
  const { userInput } = payload;
  const chatHistory = payload.chatHistory ?? [];
  const goals = (payload.goals ?? []) as Array<{
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
  const todayTasks = (payload.todayTasks ?? []) as Array<{
    id: string;
    title: string;
    completed: boolean;
    skipped?: boolean;
    cognitiveWeight?: number;
    durationMinutes?: number;
  }>;
  const todayCalendarEvents = (payload.todayCalendarEvents ?? []) as Array<{
    title: string;
    startDate: string;
    endDate: string;
    category: string;
  }>;
  const activeReminders = (payload.activeReminders ?? []) as Array<{
    id: string;
    title: string;
    description?: string;
    reminderTime?: string;
    date?: string;
    acknowledged: boolean;
    repeat?: string;
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
              `- [${t.completed ? "✓" : t.skipped ? "S" : " "}] "${t.title}" [taskId:${t.id}] (weight: ${t.cognitiveWeight || 3}, ${t.durationMinutes || 30}min)`,
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

  const remindersSummary =
    activeReminders.length > 0
      ? activeReminders
          .map((r) => {
            const time = r.reminderTime ?? r.date ?? "no time set";
            const repeat = r.repeat && r.repeat !== "none" ? `, repeats ${r.repeat}` : "";
            const ack = r.acknowledged ? " [acknowledged]" : "";
            const desc = r.description ? ` — ${r.description}` : "";
            return `- "${r.title}"${desc} (${time}${repeat})${ack}`;
          })
          .join("\n")
      : "No active reminders.";

  const environmentFormatted = payload._environmentContextFormatted ?? "";
  const environmentBlock = environmentFormatted
    ? `\n${environmentFormatted}\n`
    : "";

  const schedulingContextFormatted = payload._schedulingContextFormatted ?? "";
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
${calendarSummary}

Active reminders:
${remindersSummary}`;

  const attachments = (payload.attachments ?? []) as Array<{
    type: string;
    name: string;
    base64: string;
    mediaType: string;
  }>;

  const messages: Array<{ role: "user" | "assistant"; content: unknown }> =
    chatHistory.map((m) => ({
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
    messages.push({ role: "user", content: contentBlocks });
  } else {
    messages.push({ role: "user", content: userInput });
  }

  return {
    model: getModelForTask("home-chat"),
    maxTokens: 512,
    system: personalizeSystem(
      `${HOME_CHAT_SYSTEM}\n\n${contextBlock}`,
      memoryContext,
    ),
    messages,
  };
}

/**
 * Parse a completed home-chat LLM reply into a structured intent, or
 * return null for plain-text replies. Shared between the blocking handler
 * and the SSE streaming route so both produce identical entity shapes.
 */
export function parseHomeChatIntent(
  chatText: string,
  userInput: string,
  todayDate?: string,
): HomeChatIntent | null {
  const parsed = tryExtractJson(chatText);
  if (!parsed) return null;

  const nowIso = () => new Date().toISOString();
  // Prefer the caller's effective "today" (server computes it via the
  // 6 AM day-boundary + timezone), falling back to UTC if unavailable.
  const effectiveToday = todayDate ?? nowIso().split("T")[0];

  if (parsed.is_event) {
    const startDate = asString(parsed.startDate, nowIso());
    const endDate = asString(
      parsed.endDate,
      new Date(new Date(startDate).getTime() + 60 * 60 * 1000).toISOString(),
    );
    const durationMs =
      new Date(endDate).getTime() - new Date(startDate).getTime();
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
    return { kind: "event", entity: event };
  }

  if (parsed.is_goal) {
    const rawGoalType = asString(parsed.goalType, "big");
    const goalType: GoalShape["goalType"] =
      rawGoalType === "everyday" ||
      rawGoalType === "repeating" ||
      rawGoalType === "big"
        ? rawGoalType
        : "big";
    const rawImportance = asString(parsed.importance, "high");
    const importance: GoalShape["importance"] =
      rawImportance === "low" ||
      rawImportance === "medium" ||
      rawImportance === "high" ||
      rawImportance === "critical"
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
    return { kind: "goal", entity: goal };
  }

  if (parsed.is_reminder) {
    const reminder: ReminderShape = {
      id: randomUUID(),
      title: asString(parsed.title, userInput),
      description: asString(parsed.description),
      reminderTime: asString(parsed.reminderTime, `${effectiveToday}T09:00:00`),
      date: asString(parsed.date, effectiveToday),
      acknowledged: false,
      repeat: typeof parsed.repeat === "string" ? parsed.repeat : null,
      source: "chat",
      createdAt: nowIso(),
    };
    return { kind: "reminder", entity: reminder };
  }

  if (parsed.is_task) {
    const pendingTask: PendingTaskShape = {
      id: randomUUID(),
      userInput: asString(parsed.task_description, userInput),
      analysis: null,
      status: "analyzing",
      createdAt: nowIso(),
    };
    return { kind: "task", pendingTask };
  }

  if (parsed.manage_goal) {
    return {
      kind: "manage-goal",
      goalId: asString(parsed.goalId),
      action: asString(parsed.action),
      goalTitle: asString(parsed.goalTitle),
    };
  }

  if (parsed.manage_task) {
    const rawAction = asString(parsed.action, "complete");
    const action: "complete" | "skip" | "reschedule" =
      rawAction === "skip" ? "skip" : rawAction === "reschedule" ? "reschedule" : "complete";
    return {
      kind: "manage-task",
      taskId: asString(parsed.taskId),
      action,
      taskTitle: asString(parsed.taskTitle),
      ...(action === "reschedule" && parsed.rescheduleDate
        ? { rescheduleDate: asString(parsed.rescheduleDate) }
        : {}),
    };
  }

  if (parsed.context_change) {
    return {
      kind: "context-change",
      suggestion: asString(parsed.suggestion),
    };
  }

  if (parsed.is_research) {
    return {
      kind: "research",
      topic: asString(parsed.topic, userInput),
      relatedGoalId: asString(parsed.relatedGoalId),
    };
  }

  return null;
}

/**
 * The LLM emits raw JSON (like `{"is_task": true, "task_description": "Eat"}`)
 * whenever it detects a structured intent. That JSON is useful for intent
 * dispatch but is not a user-facing reply — persisting it as the assistant
 * message content leaks raw JSON into the chat transcript on refetch.
 * Substitute a short, generic confirmation so the persisted transcript is
 * readable. The client still gets the full `intent` object and may render
 * its own richer displayText on top (e.g., with formatted dates).
 */
export function defaultReplyForIntent(intent: HomeChatIntent): string {
  switch (intent.kind) {
    case "event":
      return `Got it — I'll add "${intent.entity.title}" to your calendar.`;
    case "goal":
      return `Created "${intent.entity.title}". Head to Planning to see the plan.`;
    case "reminder":
      return `Reminder set: "${intent.entity.title}".`;
    case "task":
      return `Got it — analyzing "${intent.pendingTask.userInput}" and adding it to pending tasks.`;
    case "manage-goal":
      return `Working on "${intent.goalTitle}".`;
    case "manage-task": {
      if (intent.action === "complete") return `Done — I've marked "${intent.taskTitle}" as complete.`;
      if (intent.action === "skip") return `Got it — I've skipped "${intent.taskTitle}" for today.`;
      if (intent.action === "reschedule") return `Moved "${intent.taskTitle}" to ${intent.rescheduleDate ?? "another day"}.`;
      return `Updated "${intent.taskTitle}".`;
    }
    case "context-change":
      return intent.suggestion || "Noted — update your monthly context in Planning.";
    case "research":
      return `Researching "${intent.topic}" for you — head to the Insights tab to see the results.`;
  }
}

export async function handleHomeChat(
  client: Anthropic,
  payload: HomeChatPayload,
  memoryContext: string,
): Promise<HomeChatResult> {
  const { userInput } = payload;
  const request = buildHomeChatRequest(payload, memoryContext);

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

  const intent = parseHomeChatIntent(chatText, userInput, payload.todayDate);
  // Always strip JSON from the user-facing reply. When the model
  // emits prose + structured intent(s), the prose carries real
  // content (reasoning, suggestions, commentary) that we don't want
  // to throw away — so prefer the sanitized text over a generic
  // defaultReplyForIntent confirmation. Only fall back to the
  // default when stripping leaves nothing but whitespace.
  const stripped = stripJsonBlocks(chatText);
  const reply =
    stripped.length > 0
      ? stripped
      : intent
        ? defaultReplyForIntent(intent)
        : chatText;
  return { reply, intent };
}

