/* Starward — AI service (thin wrappers over cloud AI endpoints)
 *
 * Every function here is a one-shot POST to /ai/<channel> with a typed
 * payload. No local state, no job queue, no progress stubs — if a page
 * needs token-by-token streaming it uses the SSE routes directly via
 * useAiStream, not this file.
 */

import type {
  ConversationMessage,
  GoalBreakdown,
  DailyLog,
  HeatmapEntry,
  RecoveryResponse,
  PaceCheck,
  GoalImportance,
  GoalScope,
  GoalType,
  GoalPlanMessage,
  GoalPlan,
  DailyTask,
  Goal,
  PlanEdit,
  PlanEditSuggestion,
  RepeatSchedule,
  Reminder,
} from "@starward/core";
import { cloudInvoke } from "./cloudTransport";
import { postSseStream } from "./transport";
import { collectEnvironment } from "./environment";
import { createLogger } from "../utils/logger";

const log = createLogger("ai:service");

async function aiRequest<T = unknown>(
  type: string,
  payload: Record<string, unknown>,
): Promise<T> {
  log.debug(`submit ${type}`, { payloadKeys: Object.keys(payload) });

  // Attach environment snapshot (local time, timezone, GPS) so the
  // server can enrich the payload with weather + location context.
  try {
    const env = await collectEnvironment();
    payload._environmentContext = env;
  } catch {
    // Environment is best-effort — never block an AI request
  }

  const started = Date.now();
  try {
    const result = await cloudInvoke<T>(`ai:${type}`, payload);
    log.debug(`${type} done (${Date.now() - started}ms)`);
    return result;
  } catch (err) {
    log.error(`${type} failed (${Date.now() - started}ms)`, err);
    const msg = err instanceof Error ? err.message : String(err);
    if (/credit balance|billing|too low/i.test(msg)) {
      throw new Error("AI features are temporarily unavailable — please check your API billing settings.");
    }
    throw err;
  }
}

export async function sendOnboardingMessage(
  messages: ConversationMessage[],
  userInput: string
): Promise<string> {
  return aiRequest<string>("onboarding", { messages, userInput });
}

export async function generateDailyTasks(
  breakdown: GoalBreakdown,
  pastLogs: DailyLog[],
  heatmap: HeatmapEntry[],
  date: string,
  _unused1?: unknown,
  _unused2?: unknown,
  goals?: Goal[],
  confirmedQuickTasks?: DailyTask[],
  vacationMode?: { active: boolean; startDate: string; endDate: string } | null,
): Promise<DailyLog> {
  // Check if today is a vacation day
  const isVacationDay = vacationMode?.active &&
    date >= vacationMode.startDate && date <= vacationMode.endDate;

  return aiRequest<DailyLog>("daily-tasks", {
    breakdown,
    pastLogs,
    heatmap,
    date,
    isVacationDay: !!isVacationDay,
    confirmedQuickTasks: (confirmedQuickTasks || []).map((t) => ({
      title: t.title,
      description: t.description,
      durationMinutes: t.durationMinutes,
      cognitiveWeight: t.cognitiveWeight,
      priority: t.priority,
      category: t.category,
    })),
    goals: (goals || []).map((g) => ({
      title: g.title,
      goalType: g.goalType,
      scope: g.scope,
      status: g.status,
      targetDate: g.targetDate,
    })),
  });
}

export async function handleRecovery(
  blockerId: string,
  breakdown: GoalBreakdown,
  todayLog: DailyLog
): Promise<RecoveryResponse> {
  return aiRequest<RecoveryResponse>("recovery", {
    blockerId,
    breakdown,
    todayLog,
  });
}

export async function paceCheck(
  breakdown: GoalBreakdown,
  logs: DailyLog[]
): Promise<PaceCheck> {
  return aiRequest<PaceCheck>("pace-check", {
    breakdown,
    logs,
  });
}

export async function getCalendarSchedule(
  startDate: string,
  endDate: string,
): Promise<{ ok: boolean; data?: unknown; summary?: string; error?: string }> {
  return cloudInvoke<{ ok: boolean; data?: unknown; summary?: string; error?: string }>(
    "calendar:schedule",
    { startDate, endDate },
  );
}

// ── Goal System AI functions ─────────────────────────────

/** Classify a goal as "small" (quick task) or "big" (needs a plan page) using NLP */
export async function classifyGoal(
  title: string,
  targetDate: string,
  importance: GoalImportance,
  isHabit: boolean,
  description: string
): Promise<{
  scope: GoalScope;
  goalType: GoalType;
  reasoning: string;
  suggestedTasks?: Array<{ title: string; description: string; dueDate: string; durationMinutes: number; priority: "must-do" | "should-do" | "bonus"; category: "learning" | "building" | "networking" | "reflection" | "planning" }>;
  repeatSchedule?: RepeatSchedule | null;
  suggestedTimeSlot?: string | null;
}> {
  return aiRequest<{
    scope: GoalScope;
    goalType: GoalType;
    reasoning: string;
    suggestedTasks?: Array<{ title: string; description: string; dueDate: string; durationMinutes: number; priority: "must-do" | "should-do" | "bonus"; category: "learning" | "building" | "networking" | "reflection" | "planning" }>;
    repeatSchedule?: RepeatSchedule | null;
    suggestedTimeSlot?: string | null;
  }>("classify-goal", {
    title,
    targetDate,
    importance,
    isHabit,
    description,
  });
}

/** Analyze a direct inline edit to the goal plan — AI reviews before committing */
export async function analyzeGoalPlanEdit(
  goalTitle: string,
  edit: PlanEdit,
  planSummary: string
): Promise<PlanEditSuggestion> {
  return aiRequest<PlanEditSuggestion>("goal-plan-edit", {
    goalTitle,
    edit,
    planSummary,
  });
}

/** Generate the initial plan for a big goal (called after classification) */
export async function generateGoalPlan(
  goalTitle: string,
  targetDate: string,
  importance: GoalImportance,
  isHabit: boolean,
  description: string
): Promise<{ reply: string; plan: GoalPlan }> {
  return aiRequest<{ reply: string; plan: GoalPlan }>("generate-goal-plan", {
    goalTitle,
    targetDate,
    importance,
    isHabit,
    description,
  });
}

/** Reallocate a goal plan — shift tasks when user is falling behind */
export async function reallocateGoalPlan(
  plan: GoalPlan,
  reason: string,
): Promise<GoalPlan> {
  const result = await aiRequest<Record<string, unknown>>("reallocate", {
    breakdown: plan,
    reason,
  });
  return (result as unknown) as GoalPlan;
}

// ── Quick Task Analysis ──────────────────────────────────

/** Analyze a quick task entered via the home chat */
export async function analyzeQuickTask(
  userInput: string,
  existingTasks: DailyTask[],
  goals: Goal[],
): Promise<{
  title: string;
  description: string;
  suggested_date: string;
  duration_minutes: number;
  cognitive_weight: 1 | 2 | 3 | 4 | 5;
  priority: "must-do" | "should-do" | "bonus";
  category: "learning" | "building" | "networking" | "reflection" | "planning";
  reasoning: string;
  conflicts_with_existing: string[];
}> {
  return aiRequest<{
    title: string;
    description: string;
    suggested_date: string;
    duration_minutes: number;
    cognitive_weight: 1 | 2 | 3 | 4 | 5;
    priority: "must-do" | "should-do" | "bonus";
    category: "learning" | "building" | "networking" | "reflection" | "planning";
    reasoning: string;
    conflicts_with_existing: string[];
  }>("analyze-quick-task", {
    userInput,
    existingTasks: existingTasks.map((t) => ({
      title: t.title,
      cognitiveWeight: t.cognitiveWeight,
      durationMinutes: t.durationMinutes,
      priority: t.priority,
    })),
    goals: goals.map((g) => ({ title: g.title, scope: g.scope })),
  });
}

/** Send a message in the home chat */
export async function sendHomeChatMessage(
  userInput: string,
  chatHistory: Array<{ role: string; content: string }>,
  goals: Goal[],
  todayTasks: DailyTask[],
  _unused?: unknown,
  attachments?: Array<{ type: string; name: string; base64: string; mediaType: string }>,
  userMessageId?: string,
  reminders?: Reminder[],
): Promise<HomeChatResult> {
  const payload = {
    userInput,
    query: userInput,
    userMessageId,
    chatHistory: chatHistory.map((m) => ({ role: m.role, content: m.content })),
    goals: goals.map((g) => ({
      id: g.id,
      title: g.title,
      scope: g.scope,
      goalType: g.goalType,
      status: g.status,
      hasPlan: !!g.plan,
      planConfirmed: g.planConfirmed,
    })),
    todayTasks: todayTasks.map((t) => ({ id: t.id, title: t.title, completed: t.completed, skipped: !!t.skipped, cognitiveWeight: t.cognitiveWeight, durationMinutes: t.durationMinutes })),
    activeReminders: (reminders || []).map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      reminderTime: r.reminderTime,
      date: r.date,
      acknowledged: r.acknowledged,
      repeat: r.repeat,
    })),
    attachments,
  };

  // Attach environment snapshot for weather/time awareness
  try {
    const env = await collectEnvironment();
    (payload as Record<string, unknown>)._environmentContext = env;
  } catch {
    // best-effort
  }

  return cloudInvoke<HomeChatResult>("ai:home-chat", payload);
}

/** Stream a home chat message via SSE for real-time token display. */
export async function streamHomeChatMessage(
  userInput: string,
  chatHistory: Array<{ role: string; content: string }>,
  goals: Goal[],
  todayTasks: DailyTask[],
  _unused?: unknown,
  attachments?: Array<{ type: string; name: string; base64: string; mediaType: string }>,
  userMessageId?: string,
  reminders?: Reminder[],
  handlers?: {
    onDelta?: (text: string) => void;
    onDone?: (result: HomeChatResult) => void;
    onError?: (msg: string) => void;
  },
): Promise<void> {
  const payload: Record<string, unknown> = {
    userInput,
    query: userInput,
    userMessageId,
    chatHistory: chatHistory.map((m) => ({ role: m.role, content: m.content })),
    goals: goals.map((g) => ({
      id: g.id,
      title: g.title,
      scope: g.scope,
      goalType: g.goalType,
      status: g.status,
      hasPlan: !!g.plan,
      planConfirmed: g.planConfirmed,
    })),
    todayTasks: todayTasks.map((t) => ({ id: t.id, title: t.title, completed: t.completed, skipped: !!t.skipped, cognitiveWeight: t.cognitiveWeight, durationMinutes: t.durationMinutes })),
    activeReminders: (reminders || []).map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      reminderTime: r.reminderTime,
      date: r.date,
      acknowledged: r.acknowledged,
      repeat: r.repeat,
    })),
    attachments,
  };

  try {
    const env = await collectEnvironment();
    payload._environmentContext = env;
  } catch {
    // best-effort
  }

  await postSseStream<HomeChatResult>("/ai/home-chat/stream", payload, {
    onDelta: handlers?.onDelta,
    onDone: handlers?.onDone,
    onError: handlers?.onError,
  });
}

// Intent shape returned by the backend home-chat handler.
// Mirrors electron/ai/handlers/homeChat.ts HomeChatIntent. Fields are
// fully populated by the backend (server-assigned IDs, defaults applied);
// the renderer only dispatches the entity to the existing store setters.
export type HomeChatIntent =
  | { kind: "event"; entity: Record<string, unknown> }
  | {
      kind: "goal";
      entity: Goal;
      /** Present when the backend eagerly dispatched generate-goal-plan */
      planJobId?: string;
    }
  | { kind: "reminder"; entity: Reminder }
  | {
      kind: "task";
      pendingTask: {
        id: string;
        userInput: string;
        analysis: null;
        status: "analyzing";
        createdAt: string;
      };
    }
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
  | { kind: "research"; topic: string; relatedGoalId: string };

export interface HomeChatResult {
  reply: string;
  /** Legacy: first intent in the list, kept so old code still compiles. */
  intent: HomeChatIntent | null;
  /** All intents the model emitted, in order. Dispatcher runs each. */
  intents?: HomeChatIntent[];
  /** Server-assigned message ids so the dashboard's optimistic merge
   *  can reconcile its in-flight rows against what got persisted. */
  userMessageId?: string;
  assistantMessageId?: string;
}

// ── News Briefing ────────────────────────────────────────

export async function fetchNewsBriefing(
  goals: Array<{
    id: string;
    title: string;
    description?: string;
    targetDate?: string;
    isHabit?: boolean;
  }>,
  topic?: string,
): Promise<import("@starward/core").NewsBriefing> {
  return aiRequest<import("@starward/core").NewsBriefing>(
    "news-briefing",
    { goals, ...(topic ? { topic } : {}) },
  );
}

