/* NorthStar — typed AI handler payloads.
 *
 * Handlers used to accept `Record<string, unknown>` and cast each field
 * with `as`. These interfaces give us autocomplete, catch misspelled
 * keys, and document what each handler actually reads off the payload.
 *
 * Nested domain objects (goal, breakdown, logs, calendar events) are
 * still loose (`unknown` or `Record<string, unknown>[]`) — fully modeling
 * them belongs to a separate domain-types pass.
 */

/** Context fields injected by the multi-agent coordinator. Optional on
 *  every payload because the server router skips the coordinator. */
export interface EnrichedPayload {
  _researchContext?: unknown;
  _researchSummary?: string;
  _researchFindings?: string[];
  _schedulingContext?: unknown;
  _schedulingContextFormatted?: string;
  _environmentContext?: unknown;
  _environmentContextFormatted?: string;
}

type LooseRow = Record<string, unknown>;
type ChatMessage = { role: string; content: string };

export interface DeviceIntegrations {
  calendar?: { enabled: boolean; selectedCalendars: string[] };
}

export interface ClassifyGoalPayload extends EnrichedPayload {
  title: string;
  targetDate: string;
  importance: string;
  isHabit: boolean;
  description?: string;
}

export interface GenerateGoalPlanPayload extends EnrichedPayload {
  goalTitle: string;
  targetDate: string;
  importance: string;
  isHabit: boolean;
  description?: string;
}

export interface GoalPlanChatPayload extends EnrichedPayload {
  goalTitle: string;
  targetDate: string;
  importance: string;
  isHabit: boolean;
  description?: string;
  chatHistory?: ChatMessage[];
  userMessage: string;
  currentPlan?: Record<string, unknown> | null;
}

export interface GoalPlanEditPayload extends EnrichedPayload {
  goalTitle: string;
  edit: Record<string, unknown>;
  planSummary: string;
}

export interface OnboardingPayload extends EnrichedPayload {
  messages?: ChatMessage[];
  userInput: string;
}

export interface AnalyzeMonthlyContextPayload extends EnrichedPayload {
  month: string;
  description: string;
}

export interface HomeChatPayload extends EnrichedPayload {
  userInput: string;
  chatHistory?: ChatMessage[];
  goals?: LooseRow[];
  todayTasks?: LooseRow[];
  todayCalendarEvents?: LooseRow[];
  activeReminders?: LooseRow[];
  attachments?: LooseRow[];
}

export interface RecoveryPayload extends EnrichedPayload {
  blockerId: string;
  breakdown?: unknown;
  roadmap?: unknown;
  todayLog?: unknown;
}

export interface GoalBreakdownPayload extends EnrichedPayload {
  goal?: unknown;
  targetDate?: string;
  dailyHours?: number;
  inAppEvents?: unknown[];
  deviceIntegrations?: DeviceIntegrations;
}

export interface ReallocatePayload extends EnrichedPayload {
  breakdown?: unknown;
  reason?: string;
  changes?: Record<string, unknown>;
  inAppEvents?: unknown[];
  deviceIntegrations?: DeviceIntegrations;
}

export interface DailyTasksPayload extends EnrichedPayload {
  breakdown?: unknown;
  roadmap?: unknown;
  pastLogs?: LooseRow[];
  date: string;
  heatmap?: unknown;
  inAppEvents?: unknown[];
  deviceIntegrations?: DeviceIntegrations;
  goalPlanSummaries?: LooseRow[];
  confirmedQuickTasks?: LooseRow[];
  todayCalendarEvents?: LooseRow[];
  everydayGoals?: LooseRow[];
  repeatingGoals?: LooseRow[];
  isVacationDay?: boolean;
}

export interface PaceCheckPayload extends EnrichedPayload {
  breakdown?: unknown;
  roadmap?: unknown;
  logs?: unknown;
}

export interface AnalyzeQuickTaskPayload extends EnrichedPayload {
  userInput: string;
  existingTasks?: LooseRow[];
  goals?: LooseRow[];
  todayCalendarEvents?: LooseRow[];
}

/** Mapping from RequestType → payload interface. Used by the router to
 *  discriminate and by callers to pick the right shape. */
export interface AIPayloadMap {
  "onboarding": OnboardingPayload;
  "goal-breakdown": GoalBreakdownPayload;
  "reallocate": ReallocatePayload;
  "daily-tasks": DailyTasksPayload;
  "recovery": RecoveryPayload;
  "pace-check": PaceCheckPayload;
  "classify-goal": ClassifyGoalPayload;
  "goal-plan-chat": GoalPlanChatPayload;
  "goal-plan-edit": GoalPlanEditPayload;
  "generate-goal-plan": GenerateGoalPlanPayload;
  "analyze-quick-task": AnalyzeQuickTaskPayload;
  "analyze-monthly-context": AnalyzeMonthlyContextPayload;
  "home-chat": HomeChatPayload;
}
