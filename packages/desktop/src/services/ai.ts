/* NorthStar — AI service (thin wrappers over cloud AI endpoints)
 *
 * Every function here is a one-shot POST to /ai/<channel> with a typed
 * payload. No local state, no job queue, no progress stubs — if a page
 * needs token-by-token streaming it uses the SSE routes directly via
 * useAiStream, not this file.
 */

import type {
  ConversationMessage,
  GoalBreakdown,
  CalendarEvent,
  DeviceIntegrations,
  DailyLog,
  HeatmapEntry,
  RecoveryResponse,
  PaceCheck,
  CalendarSchedule,
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
} from "@northstar/core";
import { cloudInvoke } from "./cloudTransport";
import { createLogger } from "../utils/logger";

const log = createLogger("ai:service");

async function aiRequest<T = unknown>(
  type: string,
  payload: Record<string, unknown>,
): Promise<T> {
  log.debug(`submit ${type}`, { payloadKeys: Object.keys(payload) });
  const started = Date.now();
  try {
    const result = await cloudInvoke<T>(`ai:${type}`, payload);
    log.debug(`${type} done (${Date.now() - started}ms)`);
    return result;
  } catch (err) {
    log.error(`${type} failed (${Date.now() - started}ms)`, err);
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
  calendarEvents?: CalendarEvent[],
  deviceIntegrations?: DeviceIntegrations,
  goals?: Goal[],
  confirmedQuickTasks?: DailyTask[],
  vacationMode?: { active: boolean; startDate: string; endDate: string } | null,
  weeklyAvailability?: import("@northstar/core").TimeBlock[]
): Promise<DailyLog> {
  // Check if today is a vacation day
  const isVacationDay = vacationMode?.active &&
    date >= vacationMode.startDate && date <= vacationMode.endDate;

  // Build a summary of all goal plans for the AI to select from.
  // Plan generators produce day labels in multiple shapes: ISO date
  // ("2026-04-11"), short "Jan 6", full weekday "Monday", abbreviated
  // "Mon", or prefixed "Mon Jan 6". Match leniently against all of them
  // so tasks scheduled for today actually surface.
  const d = new Date(date);
  const todayWeekdayLong = d.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
  const todayWeekdayShort = d.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
  const todayMonthDay = d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toLowerCase();
  const todayMonthDayPadded = todayMonthDay.replace(/\s(\d)$/, " 0$1");
  const dayMatchesToday = (rawLabel: string): boolean => {
    const label = rawLabel.toLowerCase().trim();
    if (!label) return false;
    if (label === date || label.includes(date)) return true;
    if (label === todayWeekdayLong || label === todayWeekdayShort) return true;
    if (label.startsWith(`${todayWeekdayShort} `)) return true;
    if (label === todayMonthDay || label === todayMonthDayPadded) return true;
    if (label.includes(todayMonthDay) || label.includes(todayMonthDayPadded)) return true;
    return false;
  };

  const goalPlanSummaries = (goals || [])
    .filter((g) => g.goalType === "big" || (!g.goalType && g.scope === "big"))
    .map((g) => {
      const todayTasks: Array<{
        goalId: string;
        planNodeId: string;
        title: string;
        description: string;
        durationMinutes: number;
        priority: string;
        category: string;
      }> = [];
      if (g.plan && Array.isArray(g.plan.years)) {
        for (const year of g.plan.years) {
          for (const month of year.months) {
            for (const week of month.weeks) {
              if (week.locked) continue;
              for (const day of week.days) {
                if (!dayMatchesToday(day.label)) continue;
                for (const t of day.tasks) {
                  if (t.completed) continue;
                  todayTasks.push({
                    goalId: g.id,
                    planNodeId: t.id,
                    title: t.title,
                    description: t.description,
                    durationMinutes: t.durationMinutes,
                    priority: t.priority,
                    category: t.category,
                  });
                }
              }
            }
          }
        }
      }
      return {
        goalId: g.id,
        goalTitle: g.title,
        scope: g.scope,
        goalType: g.goalType || "big",
        status: g.status,
        todayTasks,
      };
    })
    .filter((g) => g.todayTasks.length > 0);

  // Everyday goals — pending tasks to slot into the day
  const everydayGoals = (goals || [])
    .filter((g) => (g.goalType === "everyday" || (!g.goalType && g.scope === "small")) && g.status !== "completed" && g.status !== "archived")
    .map((g) => ({
      title: g.title,
      description: g.description,
      suggestedTimeSlot: g.suggestedTimeSlot || null,
      tasks: (g.flatPlan?.flatMap((s) => s.tasks) || [])
        .filter((t) => !t.completed)
        .map((t) => ({ title: t.title, description: t.description, durationMinutes: t.durationMinutes, priority: t.priority, category: t.category })),
    }))
    .filter((g) => g.tasks.length > 0);

  // Repeating goals — fixed time blocks for today
  const todayDow = new Date(date).getDay();
  const repeatingGoals = (goals || [])
    .filter((g) => g.goalType === "repeating" && g.status !== "archived" && g.repeatSchedule)
    .filter((g) => g.repeatSchedule!.daysOfWeek.includes(todayDow))
    .map((g) => ({
      title: g.title,
      timeOfDay: g.repeatSchedule!.timeOfDay || null,
      durationMinutes: g.repeatSchedule!.durationMinutes,
      frequency: g.repeatSchedule!.frequency,
    }));

  // Recurring calendar events for today
  const todayEvents = (calendarEvents || []).filter((e) => {
    const eventDate = e.startDate.split("T")[0];
    if (eventDate === date) return true;
    if (e.recurring) return true;
    return false;
  }).map((e) => ({
    title: e.title,
    startDate: e.startDate,
    endDate: e.endDate,
    durationMinutes: e.durationMinutes,
    category: e.category,
    isAllDay: e.isAllDay,
    recurring: e.recurring,
  }));

  return aiRequest<DailyLog>("daily-tasks", {
    breakdown,
    pastLogs,
    heatmap,
    date,
    inAppEvents: calendarEvents || [],
    deviceIntegrations,
    goalPlanSummaries,
    everydayGoals,
    repeatingGoals,
    isVacationDay: !!isVacationDay,
    confirmedQuickTasks: (confirmedQuickTasks || []).map((t) => ({
      title: t.title,
      description: t.description,
      durationMinutes: t.durationMinutes,
      cognitiveWeight: t.cognitiveWeight,
      priority: t.priority,
      category: t.category,
    })),
    todayCalendarEvents: todayEvents,
    weeklyAvailability: weeklyAvailability || [],
    // Pass goals for scheduling context evaluation
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
  calendarEvents?: CalendarEvent[],
  deviceIntegrations?: DeviceIntegrations
): Promise<{ ok: boolean; data?: CalendarSchedule; summary?: string; error?: string }> {
  const payload = {
    startDate,
    endDate,
    inAppEvents: calendarEvents || [],
    deviceIntegrations,
  };
  return cloudInvoke<{ ok: boolean; data?: CalendarSchedule; summary?: string; error?: string }>(
    "calendar:schedule",
    payload,
  );
}

/** List available device calendars (macOS Calendar.app).
 *  Phase 13: the Electron IPC bridge is gone. Device-calendar access
 *  will move to a Google/Apple calendar OAuth flow in a later phase —
 *  for now return an empty list so the UI doesn't crash. */
export async function listDeviceCalendars(): Promise<{ ok: boolean; calendars: string[] }> {
  return { ok: false, calendars: [] };
}

/** Import events from device calendar for a date range.
 *  See listDeviceCalendars — stubbed until cloud calendar OAuth lands. */
export async function importDeviceCalendarEvents(
  _startDate: string,
  _endDate: string,
  _selectedCalendars: string[],
): Promise<{ ok: boolean; events: Array<Record<string, unknown>>; error?: string }> {
  return {
    ok: false,
    events: [],
    error: "device calendar integration is temporarily unavailable",
  };
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

/** Send a message in the goal planning chat — AI develops the plan iteratively */
export async function sendGoalPlanMessage(
  goalTitle: string,
  targetDate: string,
  importance: GoalImportance,
  isHabit: boolean,
  description: string,
  chatHistory: GoalPlanMessage[],
  userMessage: string,
  currentPlan?: GoalPlan | null
): Promise<{ reply: string; plan?: GoalPlan; planReady: boolean; planPatch?: Record<string, unknown> | null }> {
  return aiRequest<{ reply: string; plan?: GoalPlan; planReady: boolean; planPatch?: Record<string, unknown> | null }>("goal-plan-chat", {
    goalTitle,
    targetDate,
    importance,
    isHabit,
    description,
    chatHistory,
    userMessage,
    currentPlan: currentPlan || null,
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
  calendarEvents?: CalendarEvent[]
): Promise<GoalPlan> {
  const result = await aiRequest<Record<string, unknown>>("reallocate", {
    breakdown: plan,
    reason,
    inAppEvents: calendarEvents || [],
  });
  // The reallocate handler returns the updated plan structure
  return (result as unknown) as GoalPlan;
}

// ── Quick Task Analysis ──────────────────────────────────

/** Analyze a quick task entered via the home chat */
export async function analyzeQuickTask(
  userInput: string,
  existingTasks: DailyTask[],
  goals: Goal[],
  calendarEvents?: CalendarEvent[]
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
  const today = new Date().toISOString().split("T")[0];
  // Gather today's calendar events for conflict detection
  const todayEvents = (calendarEvents || []).filter((e) => {
    const eventDate = e.startDate.split("T")[0];
    return eventDate === today || !!e.recurring;
  }).map((e) => ({
    title: e.title,
    startDate: e.startDate,
    endDate: e.endDate,
    durationMinutes: e.durationMinutes,
    category: e.category,
  }));

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
    todayCalendarEvents: todayEvents,
  });
}

/** Send a message in the home chat */
export async function sendHomeChatMessage(
  userInput: string,
  chatHistory: Array<{ role: string; content: string }>,
  goals: Goal[],
  todayTasks: DailyTask[],
  calendarEvents?: CalendarEvent[],
  attachments?: Array<{ type: string; name: string; base64: string; mediaType: string }>,
  userMessageId?: string,
): Promise<HomeChatResult> {
  const today = new Date().toISOString().split("T")[0];
  const todayEvents = (calendarEvents || []).filter((e) => {
    const eventDate = e.startDate.split("T")[0];
    return eventDate === today || !!e.recurring;
  }).map((e) => ({
    title: e.title,
    startDate: e.startDate,
    endDate: e.endDate,
    category: e.category,
  }));

  // Home chat is a one-shot cloud call. Server is responsible for
  // hydrating plan-visibility fields from the stored goal — phase 2a
  // removed the client-side summarizePlan walk that used to precompute
  // subtaskCount / visibleSubtaskCount here.
  const payload = {
    userInput,
    // Server also reads `query` to persist the user message — keep both
    // field names so the AI handler and the persistence layer agree.
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
    todayTasks: todayTasks.map((t) => ({ title: t.title, completed: t.completed, cognitiveWeight: t.cognitiveWeight, durationMinutes: t.durationMinutes })),
    todayCalendarEvents: todayEvents,
    attachments,
  };
  return cloudInvoke<HomeChatResult>("ai:home-chat", payload);
}

// Intent shape returned by the backend home-chat handler.
// Mirrors electron/ai/handlers/homeChat.ts HomeChatIntent. Fields are
// fully populated by the backend (server-assigned IDs, defaults applied);
// the renderer only dispatches the entity to the existing store setters.
export type HomeChatIntent =
  | { kind: "event"; entity: CalendarEvent }
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
  | { kind: "context-change"; suggestion: string }
  | { kind: "research"; topic: string; relatedGoalId: string };

export interface HomeChatResult {
  reply: string;
  intent: HomeChatIntent | null;
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
): Promise<import("@northstar/core").NewsBriefing> {
  return aiRequest<import("@northstar/core").NewsBriefing>(
    "news-briefing",
    { goals, ...(topic ? { topic } : {}) },
  );
}

