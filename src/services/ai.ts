/* NorthStar - AI service (calls Claude via Electron IPC) */

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
} from "../types";
import type { NewsBriefing } from "../types/agents";

export async function sendOnboardingMessage(
  messages: ConversationMessage[],
  userInput: string
): Promise<string> {
  const result = await window.electronAPI.invoke("ai:onboarding", {
    messages,
    userInput,
  });
  return result as string;
}

export async function generateGoalBreakdown(
  goal: ClarifiedGoal,
  targetDate?: string,
  dailyHours?: number,
  calendarEvents?: CalendarEvent[],
  deviceIntegrations?: DeviceIntegrations
): Promise<GoalBreakdown> {
  const result = await window.electronAPI.invoke("ai:goal-breakdown", {
    goal,
    targetDate,
    dailyHours: dailyHours || 2,
    inAppEvents: calendarEvents || [],
    deviceIntegrations,
  });
  const raw = result as Record<string, unknown>;
  return normalizeBreakdown(raw);
}

export async function reallocateGoals(
  breakdown: GoalBreakdown,
  reason: string,
  changes?: Record<string, unknown>,
  calendarEvents?: CalendarEvent[],
  deviceIntegrations?: DeviceIntegrations
): Promise<GoalBreakdown> {
  const result = await window.electronAPI.invoke("ai:reallocate", {
    breakdown,
    reason,
    changes,
    inAppEvents: calendarEvents || [],
    deviceIntegrations,
  });
  const raw = result as Record<string, unknown>;
  return normalizeBreakdown(raw);
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
  weeklyAvailability?: import("../types").TimeBlock[]
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

  const result = await window.electronAPI.invoke("ai:daily-tasks", {
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
  });
  return result as DailyLog;
}

export async function handleRecovery(
  blockerId: string,
  breakdown: GoalBreakdown,
  todayLog: DailyLog
): Promise<RecoveryResponse> {
  const result = await window.electronAPI.invoke("ai:recovery", {
    blockerId,
    breakdown,
    todayLog,
  });
  return result as RecoveryResponse;
}

export async function paceCheck(
  breakdown: GoalBreakdown,
  logs: DailyLog[]
): Promise<PaceCheck> {
  const result = await window.electronAPI.invoke("ai:pace-check", {
    breakdown,
    logs,
  });
  return result as PaceCheck;
}

export async function getCalendarSchedule(
  startDate: string,
  endDate: string,
  calendarEvents?: CalendarEvent[],
  deviceIntegrations?: DeviceIntegrations
): Promise<{ ok: boolean; data?: CalendarSchedule; summary?: string; error?: string }> {
  const result = await window.electronAPI.invoke("calendar:schedule", {
    startDate,
    endDate,
    inAppEvents: calendarEvents || [],
    deviceIntegrations,
  });
  return result as { ok: boolean; data?: CalendarSchedule; summary?: string; error?: string };
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
  const result = await window.electronAPI.invoke("ai:classify-goal", {
    title,
    targetDate,
    importance,
    isHabit,
    description,
  });
  return result as any;
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
  const result = await window.electronAPI.invoke("ai:goal-plan-chat", {
    goalTitle,
    targetDate,
    importance,
    isHabit,
    description,
    chatHistory,
    userMessage,
    currentPlan: currentPlan || null,
  });
  return result as { reply: string; plan?: GoalPlan; planReady: boolean; planPatch?: Record<string, unknown> | null };
}

/** Analyze a direct inline edit to the goal plan — AI reviews before committing */
export async function analyzeGoalPlanEdit(
  goalTitle: string,
  edit: PlanEdit,
  planSummary: string
): Promise<PlanEditSuggestion> {
  const result = await window.electronAPI.invoke("ai:goal-plan-edit", {
    goalTitle,
    edit,
    planSummary,
  });
  return result as PlanEditSuggestion;
}

/** Generate the initial plan for a big goal (called after classification) */
export async function generateGoalPlan(
  goalTitle: string,
  targetDate: string,
  importance: GoalImportance,
  isHabit: boolean,
  description: string
): Promise<{ reply: string; plan: GoalPlan }> {
  const result = await window.electronAPI.invoke("ai:generate-goal-plan", {
    goalTitle,
    targetDate,
    importance,
    isHabit,
    description,
  });
  return result as { reply: string; plan: GoalPlan };
}

// Normalize snake_case AI output to camelCase types
function normalizeBreakdown(raw: Record<string, unknown>): GoalBreakdown {
  const yearly = (raw.yearly_breakdown || raw.yearlyBreakdown || []) as Array<Record<string, unknown>>;
  return {
    id: (raw.id as string) || `breakdown-${Date.now()}`,
    goalSummary: (raw.goal_summary || raw.goalSummary || "") as string,
    totalEstimatedHours: (raw.total_estimated_hours || raw.totalEstimatedHours || 0) as number,
    projectedCompletion: (raw.projected_completion || raw.projectedCompletion || "") as string,
    confidenceLevel: (raw.confidence_level || raw.confidenceLevel || "medium") as "high" | "medium" | "low",
    reasoning: (raw.reasoning || "") as string,
    yearlyBreakdown: yearly.map(normalizeYear),
    reallocationSummary: raw.reallocation_summary
      ? normalizeReallocation(raw.reallocation_summary as Record<string, unknown>)
      : undefined,
    createdAt: (raw.createdAt || new Date().toISOString()) as string,
    updatedAt: (raw.updatedAt || new Date().toISOString()) as string,
    version: (raw.version || 1) as number,
  };
}

function normalizeYear(y: Record<string, unknown>) {
  const months = (y.months || []) as Array<Record<string, unknown>>;
  return {
    year: y.year as number,
    theme: (y.theme || "") as string,
    outcome: (y.outcome || "") as string,
    months: months.map(normalizeMonth),
  };
}

function normalizeMonth(m: Record<string, unknown>) {
  const weeks = (m.weeks || []) as Array<Record<string, unknown>>;
  return {
    month: (m.month || "") as string,
    label: (m.label || "") as string,
    focus: (m.focus || "") as string,
    objectives: (m.objectives || []) as string[],
    reasoning: (m.reasoning || "") as string,
    adjustedFor: (m.adjusted_for || m.adjustedFor || null) as string | null,
    estimatedHours: (m.estimated_hours || m.estimatedHours || 0) as number,
    weeks: weeks.map(normalizeWeek),
  };
}

function normalizeWeek(w: Record<string, unknown>) {
  const days = (w.days || []) as Array<Record<string, unknown>>;
  return {
    weekNumber: (w.week_number || w.weekNumber || 0) as number,
    startDate: (w.start_date || w.startDate || "") as string,
    endDate: (w.end_date || w.endDate || "") as string,
    focus: (w.focus || "") as string,
    deliverables: (w.deliverables || []) as string[],
    estimatedHours: (w.estimated_hours || w.estimatedHours || 0) as number,
    intensity: (w.intensity || "normal") as "light" | "normal" | "heavy",
    days: days.map(normalizeDay),
  };
}

function normalizeDay(d: Record<string, unknown>) {
  const tasks = (d.tasks || []) as Array<Record<string, unknown>>;
  return {
    date: (d.date || "") as string,
    dayName: (d.day_name || d.dayName || "") as string,
    availableMinutes: (d.available_minutes || d.availableMinutes || 0) as number,
    isVacation: (d.is_vacation || d.isVacation || false) as boolean,
    isWeekend: (d.is_weekend || d.isWeekend || false) as boolean,
    tasks: tasks.map((t) => ({
      title: (t.title || "") as string,
      description: (t.description || "") as string,
      durationMinutes: (t.duration_minutes || t.durationMinutes || 0) as number,
      category: (t.category || "learning") as "learning" | "building" | "networking" | "reflection" | "planning",
      whyToday: (t.why_today || t.whyToday || "") as string,
      priority: (t.priority || "should-do") as "must-do" | "should-do" | "bonus",
    })),
  };
}

function normalizeReallocation(r: Record<string, unknown>) {
  return {
    reason: (r.reason || "") as string,
    daysAffected: (r.days_affected || r.daysAffected || 0) as number,
    tasksMoved: (r.tasks_moved || r.tasksMoved || 0) as number,
    timelineImpact: (r.timeline_impact || r.timelineImpact || "") as string,
    keyChanges: (r.key_changes || r.keyChanges || []) as string[],
  };
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

  const result = await window.electronAPI.invoke("ai:analyze-quick-task", {
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
  return result as any;
}

/** Send a message in the home chat */
export async function sendHomeChatMessage(
  userInput: string,
  chatHistory: Array<{ role: string; content: string }>,
  goals: Goal[],
  todayTasks: DailyTask[],
  calendarEvents?: CalendarEvent[]
): Promise<{ reply: string }> {
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

  const result = await window.electronAPI.invoke("ai:home-chat", {
    userInput,
    chatHistory: chatHistory.map((m) => ({ role: m.role, content: m.content })),
    goals: goals.map((g) => ({ title: g.title, scope: g.scope, status: g.status })),
    todayTasks: todayTasks.map((t) => ({ title: t.title, completed: t.completed, cognitiveWeight: t.cognitiveWeight })),
    todayCalendarEvents: todayEvents,
  });
  return result as { reply: string };
}

// ── Multi-Agent Functions ────────────────────────────────

/** Fetch daily news briefing related to user's goals */
export async function fetchNewsBriefing(
  goalTitles: string[],
  userInterests: string[]
): Promise<{ ok: boolean; data?: NewsBriefing; error?: string }> {
  const result = await window.electronAPI.invoke("ai:news-briefing", {
    goalTitles,
    userInterests,
  });
  return result as { ok: boolean; data?: NewsBriefing; error?: string };
}
