/* Starward — Home Chat handler

   Owns LLM-output parsing, ID generation, defaulting, and eager job
   dispatch for intents detected in the reply. The renderer receives a
   fully-populated entity (with a server ID) and only dispatches it to
   the existing store setters — no client-side JSON parsing or
   business-rule branching.
*/

import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { getModelForTask } from "../../model-config.js";
import { HOME_CHAT_SYSTEM } from "../prompts/index.js";
import { personalizeSystem } from "../personalize.js";
import type { HomeChatPayload } from "../payloads.js";

// ── Result shapes ────────────────────────────────────────

export type HomeChatIntent =
  | { kind: "event"; entity: CalendarEventShape }
  | { kind: "goal"; entity: GoalShape; planJobId?: string }
  | { kind: "reminder"; entity: ReminderShape }
  | { kind: "task"; pendingTask: PendingTaskShape }
  | { kind: "manage-goal"; goalId: string; action: string; goalTitle: string }
  | {
      kind: "manage-task";
      taskId: string;
      action: "complete" | "skip" | "reschedule" | "delete" | "delete_all";
      taskTitle: string;
      rescheduleDate?: string;
      match?: string;
    }
  | {
      kind: "manage-reminder";
      action: "delete" | "delete_all" | "edit" | "acknowledge";
      reminderId?: string;
      match?: string;
      keepMatch?: string;
      patch?: {
        title?: string;
        description?: string;
        reminderTime?: string;
        date?: string;
        repeat?: string | null;
      };
      reminderTitle?: string;
    }
  | {
      kind: "manage-event";
      action: "delete" | "delete_all" | "edit" | "reschedule";
      eventId?: string;
      match?: string;
      patch?: {
        title?: string;
        startDate?: string;
        endDate?: string;
        category?: string;
      };
      eventTitle?: string;
    }
  | { kind: "context-change"; suggestion: string }
  | { kind: "research"; topic: string; relatedGoalId: string }
  | {
      /** Per-task cognitive-load override. Maps to the existing
       *  command:override-cognitive-load (Phase D of cognitive-load
       *  architecture). The dispatcher resolves `match` to one or
       *  more tasks and fires the command per matched task. */
      kind: "manage-task-load";
      /** "easier" / "harder" → step the load by one level relative
       *  to the task's current value.
       *  "high" / "medium" / "low" → set the load directly. */
      perceivedLoad: "easier" | "harder" | "high" | "medium" | "low";
      /** Title-substring selector. When match selects multiple tasks
       *  the dispatcher fans out per task. */
      match?: string;
      /** Optional explicit task title for AI confirmation phrasing. */
      taskTitle?: string;
    };

export interface HomeChatResult {
  reply: string;
  /** Legacy single-intent field — equals intents[0] when present. Kept so
   *  older callers that only read `intent` still work. */
  intent: HomeChatIntent | null;
  /** All intents the model emitted in this reply, in order. The home chat
   *  can now emit multiple JSON blocks in one message (e.g. "delete all my
   *  reminders, then create these two") and the dispatcher executes every
   *  one in sequence. */
  intents: HomeChatIntent[];
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
  /** Date the AI resolved from user input (defaults to today). */
  suggestedDate?: string;
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
  const all = tryExtractAllJson(text);
  return all.length > 0 ? all[0] : null;
}

/** Extract every JSON object literal from the LLM reply, in order.
 *  Used by parseHomeChatIntents so a single message like
 *    "{"manage_reminder":true,...} {"is_reminder":true,...}"
 *  produces multiple intents the dispatcher can execute in sequence. */
function tryExtractAllJson(text: string): Array<Record<string, unknown>> {
  const trimmed = text.trim();
  const out: Array<Record<string, unknown>> = [];

  // 1. Clean JSON — single object, no prose.
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null) {
      return [parsed as Record<string, unknown>];
    }
  } catch {
    /* fall through */
  }

  // 2. Markdown code fences — grab every fenced block.
  const fenceRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?```/g;
  let fenceMatch: RegExpExecArray | null;
  let anyFenced = false;
  while ((fenceMatch = fenceRegex.exec(trimmed)) !== null) {
    anyFenced = true;
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (typeof parsed === "object" && parsed !== null) {
        out.push(parsed as Record<string, unknown>);
      }
    } catch {
      /* try next fence */
    }
  }
  if (out.length > 0) return out;

  // 3. Walk every balanced-brace span and collect every one that parses.
  //    Handles the multi-intent case where the LLM emits several JSON
  //    blocks interleaved with prose.
  for (const span of findBalancedJsonObjects(trimmed)) {
    try {
      const parsed = JSON.parse(span.text);
      if (typeof parsed === "object" && parsed !== null) {
        out.push(parsed as Record<string, unknown>);
      }
    } catch {
      /* try next span */
    }
  }

  if (out.length === 0 && !anyFenced) {
    console.warn(
      "[ai:homeChat:json] failed to extract JSON from LLM response:",
      trimmed.slice(0, 500),
    );
  }
  return out;
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

  const remindersSummary =
    activeReminders.length > 0
      ? activeReminders
          .map((r) => {
            const time = r.reminderTime ?? r.date ?? "no time set";
            const repeat = r.repeat && r.repeat !== "none" ? `, repeats ${r.repeat}` : "";
            const ack = r.acknowledged ? " [acknowledged]" : "";
            const desc = r.description ? ` — ${r.description}` : "";
            return `- "${r.title}"${desc} (${time}${repeat})${ack} [reminderId:${r.id}]`;
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

  const todayLine = `Today: ${payload.todayDate ?? new Date().toISOString().split("T")[0]}`;

  const contextBlock = `USER CONTEXT:
${todayLine}
${environmentBlock}${schedulingBlock}Goals:
${goalsSummary}

Today's tasks (${completedCount}/${todayTasks.length} done, ${taskCount} pending):
  Cognitive load: ${totalWeight}/12 points used
  Time committed: ${totalMinutes}/180 minutes used
  Active tasks: ${taskCount}/5 slots used
${tasksSummary}

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
 * Parse a completed home-chat LLM reply into a list of structured intents.
 * A single reply may contain multiple JSON blocks — e.g. "delete all
 * reminders, then create these two" — and each block becomes its own
 * intent the dispatcher executes in order.
 */
export function parseHomeChatIntents(
  chatText: string,
  userInput: string,
  todayDate?: string,
): HomeChatIntent[] {
  const blocks = tryExtractAllJson(chatText);
  const out: HomeChatIntent[] = [];
  for (const parsed of blocks) {
    const intent = parseSingleIntent(parsed, userInput, todayDate);
    if (intent) out.push(intent);
  }
  return out;
}

/**
 * Legacy single-intent parser — returns the first intent found, or null.
 * Kept for callers (like the SSE route) that still expect a single intent;
 * new code should use parseHomeChatIntents.
 */
export function parseHomeChatIntent(
  chatText: string,
  userInput: string,
  todayDate?: string,
): HomeChatIntent | null {
  const list = parseHomeChatIntents(chatText, userInput, todayDate);
  return list.length > 0 ? list[0] : null;
}

function parseSingleIntent(
  parsed: Record<string, unknown>,
  userInput: string,
  todayDate?: string,
): HomeChatIntent | null {
  const nowIso = () => new Date().toISOString();
  // Prefer the caller's effective "today" (server computes it via the
  // midnight day-boundary + timezone), falling back to UTC if unavailable.
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
      suggestedDate: asString(parsed.task_date) || effectiveToday,
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
    const action: "complete" | "skip" | "reschedule" | "delete" | "delete_all" =
      rawAction === "skip"
        ? "skip"
        : rawAction === "reschedule"
          ? "reschedule"
          : rawAction === "delete"
            ? "delete"
            : rawAction === "delete_all"
              ? "delete_all"
              : "complete";
    return {
      kind: "manage-task",
      taskId: asString(parsed.taskId),
      action,
      taskTitle: asString(parsed.taskTitle),
      ...(action === "reschedule" && parsed.rescheduleDate
        ? { rescheduleDate: asString(parsed.rescheduleDate) }
        : {}),
      ...(typeof parsed.match === "string" ? { match: parsed.match } : {}),
    };
  }

  if (parsed.manage_task_load) {
    // Validate perceivedLoad against the canonical enum. Anything
    // unrecognized falls back to "easier" (the safer default —
    // overriding harder is a stronger statement).
    const rawLoad = asString(parsed.perceivedLoad, "easier");
    const perceivedLoad: "easier" | "harder" | "high" | "medium" | "low" =
      rawLoad === "harder"
        ? "harder"
        : rawLoad === "high"
          ? "high"
          : rawLoad === "medium"
            ? "medium"
            : rawLoad === "low"
              ? "low"
              : "easier";
    return {
      kind: "manage-task-load",
      perceivedLoad,
      ...(typeof parsed.match === "string" ? { match: parsed.match } : {}),
      ...(typeof parsed.taskTitle === "string"
        ? { taskTitle: parsed.taskTitle }
        : {}),
    };
  }

  if (parsed.manage_reminder) {
    const rawAction = asString(parsed.action, "delete");
    const action: "delete" | "delete_all" | "edit" | "acknowledge" =
      rawAction === "delete_all"
        ? "delete_all"
        : rawAction === "edit"
          ? "edit"
          : rawAction === "acknowledge"
            ? "acknowledge"
            : "delete";
    const patchRaw = (parsed.patch ?? {}) as Record<string, unknown>;
    const patch = {
      ...(typeof patchRaw.title === "string" ? { title: patchRaw.title } : {}),
      ...(typeof patchRaw.description === "string"
        ? { description: patchRaw.description }
        : {}),
      ...(typeof patchRaw.reminderTime === "string"
        ? { reminderTime: patchRaw.reminderTime }
        : {}),
      ...(typeof patchRaw.date === "string" ? { date: patchRaw.date } : {}),
      ...(typeof patchRaw.repeat === "string"
        ? { repeat: patchRaw.repeat }
        : patchRaw.repeat === null
          ? { repeat: null }
          : {}),
    };
    return {
      kind: "manage-reminder",
      action,
      ...(typeof parsed.reminderId === "string" && parsed.reminderId
        ? { reminderId: parsed.reminderId }
        : {}),
      ...(typeof parsed.match === "string" ? { match: parsed.match } : {}),
      ...(typeof parsed.keepMatch === "string"
        ? { keepMatch: parsed.keepMatch }
        : {}),
      ...(Object.keys(patch).length > 0 ? { patch } : {}),
      ...(typeof parsed.reminderTitle === "string"
        ? { reminderTitle: parsed.reminderTitle }
        : {}),
    };
  }

  if (parsed.manage_event) {
    const rawAction = asString(parsed.action, "delete");
    const action: "delete" | "delete_all" | "edit" | "reschedule" =
      rawAction === "delete_all"
        ? "delete_all"
        : rawAction === "edit"
          ? "edit"
          : rawAction === "reschedule"
            ? "reschedule"
            : "delete";
    const patchRaw = (parsed.patch ?? {}) as Record<string, unknown>;
    const patch = {
      ...(typeof patchRaw.title === "string" ? { title: patchRaw.title } : {}),
      ...(typeof patchRaw.startDate === "string"
        ? { startDate: patchRaw.startDate }
        : {}),
      ...(typeof patchRaw.endDate === "string"
        ? { endDate: patchRaw.endDate }
        : {}),
      ...(typeof patchRaw.category === "string"
        ? { category: patchRaw.category }
        : {}),
    };
    return {
      kind: "manage-event",
      action,
      ...(typeof parsed.eventId === "string" && parsed.eventId
        ? { eventId: parsed.eventId }
        : {}),
      ...(typeof parsed.match === "string" ? { match: parsed.match } : {}),
      ...(Object.keys(patch).length > 0 ? { patch } : {}),
      ...(typeof parsed.eventTitle === "string"
        ? { eventTitle: parsed.eventTitle }
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
      if (intent.action === "delete") return `Deleted "${intent.taskTitle}".`;
      if (intent.action === "delete_all") return `Cleared every task for today.`;
      return `Updated "${intent.taskTitle}".`;
    }
    case "manage-reminder": {
      if (intent.action === "delete")
        return `Deleted reminder${intent.reminderTitle ? ` "${intent.reminderTitle}"` : ""}.`;
      if (intent.action === "delete_all")
        return intent.keepMatch
          ? `Cleared your reminders (keeping ${intent.keepMatch}).`
          : `Cleared your reminders.`;
      if (intent.action === "edit")
        return `Updated reminder${intent.reminderTitle ? ` "${intent.reminderTitle}"` : ""}.`;
      if (intent.action === "acknowledge")
        return `Marked reminder${intent.reminderTitle ? ` "${intent.reminderTitle}"` : ""} as acknowledged.`;
      return `Updated reminder.`;
    }
    case "manage-event": {
      if (intent.action === "delete")
        return `Removed ${intent.eventTitle ? `"${intent.eventTitle}"` : "that event"} from your calendar.`;
      if (intent.action === "delete_all") return `Cleared your calendar.`;
      if (intent.action === "edit" || intent.action === "reschedule")
        return `Updated ${intent.eventTitle ? `"${intent.eventTitle}"` : "that event"}.`;
      return `Updated event.`;
    }
    case "context-change":
      return intent.suggestion || "Noted — update your monthly context in Planning.";
    case "research":
      return `Researching "${intent.topic}" for you — head to the Insights tab to see the results.`;
    case "manage-task-load": {
      const target = intent.taskTitle ?? intent.match ?? "those tasks";
      const loadCopy =
        intent.perceivedLoad === "easier" || intent.perceivedLoad === "low"
          ? "lighter"
          : intent.perceivedLoad === "harder" || intent.perceivedLoad === "high"
            ? "heavier"
            : "moderate";
      return `Got it — I'll record "${target}" as ${loadCopy}. The system will learn from this.`;
    }
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

  const intents = parseHomeChatIntents(chatText, userInput, payload.todayDate);
  const intent = intents.length > 0 ? intents[0] : null;
  // Always strip JSON from the user-facing reply. When the model emits
  // prose + structured intent(s), the prose carries real content
  // (reasoning, commentary) we keep alongside the per-intent
  // confirmations the client generates. When the model emits ONLY JSON,
  // we leave `reply` empty so the client renders its own intent-derived
  // messages without duplication; the legacy fallback to
  // defaultReplyForIntent still kicks in when there are no intents at
  // all (pure-text replies the parser couldn't match to a schema).
  const stripped = stripJsonBlocks(chatText);
  const reply =
    stripped.length > 0
      ? stripped
      : intents.length > 0
        ? ""
        : chatText;
  return { reply, intent, intents };
}

