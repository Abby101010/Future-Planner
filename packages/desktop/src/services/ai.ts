/* NorthStar — AI service (calls Claude via the cloud backend)
 *
 * Phase 2a: dead client-side normalizers and job-status stubs were
 * deleted. Plan-shape normalization, sanitization, and progress
 * tracking will be rebuilt server-side in phase 4+ and SSE in phase 8.
 * generateGoalBreakdown / reallocateGoals now throw at runtime so
 * any remaining call sites are loud.
 */

import type {
  ConversationMessage,
  ClarifiedGoal,
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
import type { NewsBriefing } from "@northstar/core";
import { cloudInvoke } from "./cloudTransport";
import { createLogger } from "../utils/logger";

const log = createLogger("ai:service");

/**
 * Submit an AI request and return the result. Now a one-shot HTTP POST
 * — the local SQLite job_queue + JobRunner that used to back this in
 * dev mode were deleted in slice 6. Throws if VITE_CLOUD_API_URL is not
 * set at build time, since there is no longer any local fallback.
 *
 * The optional `onProgress` callback is accepted for source compatibility
 * with the old job-queue API but never fires — phase 1c will add SSE
 * streaming and start emitting progress events again.
 */
async function submitAndWait<T = unknown>(
  type: string,
  payload: Record<string, unknown>,
  _onProgress?: (progress: number, log: unknown[]) => void,
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

// ── Progress-tracking stubs ─────────────────────────────
// Slice 6 deleted the local job queue, so there is nothing for these to
// query anymore. They remain as null-returning stubs so existing call
// sites (TasksPage, GoalPlanPage, AgentProgress) keep compiling and
// silently render no progress UI. Phase 1c will replace them with real
// SSE-backed implementations.

/** Get the jobId for a recently submitted job (no-op since slice 6). */
export async function getActiveJobId(_type: string): Promise<string | null> {
  return null;
}

/** Get job status for progress display (no-op since slice 6). */
export async function getJobStatus(_jobId: string): Promise<{
  status: string;
  progress: number;
  progress_log: unknown[];
  result: unknown;
  error: string | null;
} | null> {
  return null;
}

/** Cancel a running/pending job (no-op since slice 6). */
export async function cancelJobById(_jobId: string): Promise<boolean> {
  return false;
}

export async function sendOnboardingMessage(
  messages: ConversationMessage[],
  userInput: string
): Promise<string> {
  return submitAndWait<string>("onboarding", { messages, userInput });
}

export async function generateGoalBreakdown(
  _goal: ClarifiedGoal,
  _targetDate?: string,
  _dailyHours?: number,
  _calendarEvents?: CalendarEvent[],
  _deviceIntegrations?: DeviceIntegrations
): Promise<GoalBreakdown> {
  throw new Error("moved to server in phase 4+");
}

export async function reallocateGoals(
  _breakdown: GoalBreakdown,
  _reason: string,
  _changes?: Record<string, unknown>,
  _calendarEvents?: CalendarEvent[],
  _deviceIntegrations?: DeviceIntegrations
): Promise<GoalBreakdown> {
  throw new Error("moved to server in phase 4+");
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

  // Build a summary of all goal plans for the AI to select from
  const goalPlanSummaries = (goals || [])
    .filter((g) => g.goalType === "big" || (!g.goalType && g.scope === "big"))
    .map((g) => {
      const todayTasks: Array<{ title: string; description: string; durationMinutes: number; priority: string; category: string }> = [];
      if (g.plan && Array.isArray(g.plan.years)) {
        const todayDayName = new Date(date).toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
        const todayDateLabel = new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toLowerCase();
        for (const year of g.plan.years) {
          for (const month of year.months) {
            for (const week of month.weeks) {
              if (!week.locked) {
                for (const day of week.days) {
                  const dayLabel = day.label.toLowerCase();
                  if (dayLabel === todayDayName || dayLabel.includes(todayDateLabel) || dayLabel.includes(date)) {
                    for (const t of day.tasks) {
                      if (!t.completed) {
                        todayTasks.push({ title: t.title, description: t.description, durationMinutes: t.durationMinutes, priority: t.priority, category: t.category });
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      return { goalTitle: g.title, scope: g.scope, goalType: g.goalType || "big", status: g.status, todayTasks };
    }).filter((g) => g.todayTasks.length > 0);

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

  return submitAndWait<DailyLog>("daily-tasks", {
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
  return submitAndWait<RecoveryResponse>("recovery", {
    blockerId,
    breakdown,
    todayLog,
  });
}

export async function paceCheck(
  breakdown: GoalBreakdown,
  logs: DailyLog[]
): Promise<PaceCheck> {
  return submitAndWait<PaceCheck>("pace-check", {
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

/** List available device calendars (macOS Calendar.app) */
export async function listDeviceCalendars(): Promise<{ ok: boolean; calendars: string[] }> {
  const result = await window.electronAPI.invoke("device:list-calendars");
  return result as { ok: boolean; calendars: string[] };
}

/** Import events from device calendar for a date range */
export async function importDeviceCalendarEvents(
  startDate: string,
  endDate: string,
  selectedCalendars: string[]
): Promise<{ ok: boolean; events: Array<Record<string, unknown>>; error?: string }> {
  const result = await window.electronAPI.invoke("device:import-calendar-events", {
    startDate,
    endDate,
    selectedCalendars,
  });
  return result as { ok: boolean; events: Array<Record<string, unknown>>; error?: string };
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
  return submitAndWait<{
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
  return submitAndWait<{ reply: string; plan?: GoalPlan; planReady: boolean; planPatch?: Record<string, unknown> | null }>("goal-plan-chat", {
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
  return submitAndWait<PlanEditSuggestion>("goal-plan-edit", {
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
  return submitAndWait<{ reply: string; plan: GoalPlan }>("generate-goal-plan", {
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
  const result = await submitAndWait<Record<string, unknown>>("reallocate", {
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

  return submitAndWait<{
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
  attachments?: Array<{ type: string; name: string; base64: string; mediaType: string }>
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
  | { kind: "context-change"; suggestion: string };

export interface HomeChatResult {
  reply: string;
  intent: HomeChatIntent | null;
}

// ── Multi-Agent Functions ────────────────────────────────

/** Fetch daily news briefing related to user's goals */
export async function fetchNewsBriefing(
  goalTitles: string[],
  userInterests: string[]
): Promise<{ ok: boolean; data?: NewsBriefing; error?: string }> {
  try {
    const data = await submitAndWait<NewsBriefing>("news-digest", {
      goalTitles,
      userInterests,
    });
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
