/* NorthStar — typed AI handler payloads.
 *
 * Handlers used to accept `Record<string, unknown>` and cast each field
 * with `as`. These interfaces give us autocomplete, catch misspelled
 * keys, and document what each handler actually reads off the payload.
 *
 * Nested domain objects (goal, breakdown, logs) are still loose (`unknown`
 * or `Record<string, unknown>[]`) — fully modeling them belongs to a
 * separate domain-types pass.
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
  goalId?: string;
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
  activeReminders?: LooseRow[];
  attachments?: LooseRow[];
  /** Caller-supplied effective "today" (midnight boundary + timezone). When
   *  absent, the parser falls back to UTC — prefer always passing this
   *  from the server so reminder/event dates land on the same day the
   *  TasksView filters on. */
  todayDate?: string;
}

export interface UnifiedChatPayload extends EnrichedPayload {
  userInput: string;
  chatHistory?: ChatMessage[];
  context?: {
    currentPage: string;
    selectedGoalId?: string;
    selectedGoalPlan?: Record<string, unknown>;
    goalTitle?: string;
    targetDate?: string;
    importance?: string;
    isHabit?: boolean;
    description?: string;
    visibleTasks?: LooseRow[];
    weeklyReviewDue?: boolean;
    activeGoals?: LooseRow[];
    activeReminders?: LooseRow[];
    overloadAdvisory?: LooseRow | null;
  };
  goals?: LooseRow[];
  todayTasks?: LooseRow[];
  activeReminders?: LooseRow[];
  attachments?: LooseRow[];
  todayDate?: string;
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
}

export interface ReallocatePayload extends EnrichedPayload {
  breakdown?: unknown;
  reason?: string;
  changes?: Record<string, unknown>;
}

export interface DailyTasksPayload extends EnrichedPayload {
  breakdown?: unknown;
  roadmap?: unknown;
  pastLogs?: LooseRow[];
  date: string;
  heatmap?: unknown;
  goalPlanSummaries?: LooseRow[];
  confirmedQuickTasks?: LooseRow[];
  everydayGoals?: LooseRow[];
  repeatingGoals?: LooseRow[];
  isVacationDay?: boolean;
  /** Active reminders for `date`. Feeds into the dailyTasks prompt so the
   *  AI schedules around them instead of double-booking those minutes. */
  todayReminders?: LooseRow[];
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
}

export type ImageToTodosMediaType = "image/jpeg" | "image/png" | "image/webp";

export type ImageToTodosSource = "upload" | "paste" | "screenshot";

export interface ImageToTodosPayload extends EnrichedPayload {
  /** Raw base64 image data (no `data:` prefix). */
  imageBase64: string;
  mediaType: ImageToTodosMediaType;
  source: ImageToTodosSource;
  /** Optional user-provided hint about what's in the image. */
  userHint?: string;
  /** Caller's effective "today" — anchors suggestedDate resolution. */
  todayDate?: string;
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
  "chat": UnifiedChatPayload;
  "image-to-todos": ImageToTodosPayload;
}
