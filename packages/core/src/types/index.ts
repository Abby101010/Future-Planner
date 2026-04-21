/* NorthStar - shared type definitions */

// User
export interface UserProfile {
  id: string;
  name: string;
  age?: number;
  currentRole?: string;
  education?: string;
  location?: string;
  timezone?: string;  // IANA timezone, e.g. "America/New_York"
  goalRaw: string;
  context?: string;
  timeAvailable?: string;
  constraints?: string;
  moodBaseline?: string;
  onboardingComplete?: boolean;
  weeklyAvailability?: TimeBlock[];
  createdAt: string;
  settings: UserSettings;
}

/** A single time block in the weekly availability grid */
export interface TimeBlock {
  day: number;        // 0=Mon, 1=Tue, ... 6=Sun
  hour: number;       // 0-23
  importance: 1 | 2 | 3;  // saturation level: 1=light, 2=medium, 3=high
  label: string;      // brief description of what this time is for
}

export const USER_SEGMENTS = [
  "career-transition",
  "freelancer",
  "side-project",
  "general",
] as const;
export type UserSegment = typeof USER_SEGMENTS[number];

export interface UserSettings {
  enableNewsFeed: boolean;
  dailyReminderTime?: string;
  theme: "light" | "dark" | "system";
  language: "en" | "zh";
  apiKey?: string;
  modelOverrides?: Partial<Record<"heavy" | "medium" | "light", string>>;
  /** Phase B: per-user cognitive-load ceiling. Scheduler sums task cognitiveCost
   *  against this and defers lowest-tier tasks to the pending pool if exceeded.
   *  When null, server defaults to personalization.maxDailyWeight ?? 22. */
  dailyCognitiveBudget?: number | null;
  /** Phase B segment: drives priorityAnnotator RAG + prompt + scheduler
   *  deferral policy. Undefined / null behaves identically to "general". */
  userSegment?: UserSegment | null;
  /** B-2: when true, scheduler matches today's tasks to weeklyAvailability
   *  slots based on cognitiveLoad and writes scheduled_start/end ISO. Default
   *  false → no scheduler-originated time-block writes (byte-identical). */
  cognitiveLoadMatchingEnabled?: boolean;
  /** A-4: when true, scheduler uses the blended finalScore (tier × priorityScore
   *  × recency) to order tasks within a budget-kept set. Default false preserves
   *  Phase-1 (tier, cost) ordering byte-for-byte. */
  priorityArbitrationEnabled?: boolean;
  /** B-3: when true, the slot matcher consults the per-(hour, dow, category)
   *  completion-rate weights learned by the nightly energy-profile job and
   *  uses them as a tie-break between equally-suited slots. Default false
   *  → matcher behaves exactly as B-2 shipped. */
  dataDrivenEnergyEnabled?: boolean;
  /** B-4: when true, `command:propose-gap-fillers` may write proposals
   *  into `pending_tasks` for calendar gaps ≥ 15 min. Default false →
   *  the command is a no-op, no pending_tasks writes originate here. */
  gapFillersEnabled?: boolean;
}

// Onboarding
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface ClarifiedGoal {
  goal: string;
  startingPoint: string;
  targetOutcome: string;
  timeline: string;
  timeBudget: string;
  constraints: string;
  motivation: string;
}

// Goal Breakdown (the main feature)
export interface GoalBreakdown {
  id: string;
  goalSummary: string;
  totalEstimatedHours: number;
  projectedCompletion: string;
  confidenceLevel: "high" | "medium" | "low";
  reasoning: string;
  yearlyBreakdown: YearPlan[];
  reallocationSummary?: ReallocationSummary;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface YearPlan {
  year: number;
  theme: string;
  outcome: string;
  months: MonthPlan[];
}

export interface MonthPlan {
  month: string;
  label: string;
  focus: string;
  objectives: string[];
  reasoning: string;
  adjustedFor: string | null;
  estimatedHours: number;
  weeks: WeekPlan[];
}

export interface WeekPlan {
  weekNumber: number;
  startDate: string;
  endDate: string;
  focus: string;
  deliverables: string[];
  estimatedHours: number;
  intensity: "light" | "normal" | "heavy";
  days: DayPlan[];
}

export interface DayPlan {
  date: string;
  dayName: string;
  availableMinutes: number;
  isVacation: boolean;
  isWeekend: boolean;
  tasks: BreakdownTask[];
}

export interface BreakdownTask {
  title: string;
  description: string;
  durationMinutes: number;
  category: "learning" | "building" | "networking" | "reflection" | "planning";
  whyToday: string;
  priority: "must-do" | "should-do" | "bonus";
}

export interface ReallocationSummary {
  reason: string;
  daysAffected: number;
  tasksMoved: number;
  timelineImpact: string;
  keyChanges: string[];
}

// Legacy Roadmap (backward compat)
export interface Roadmap {
  id: string;
  userId: string;
  goalSummary: string;
  projectedCompletion: string;
  confidenceLevel: "high" | "medium" | "low";
  totalEstimatedHours: number;
  planPhilosophy: string;
  milestones: Milestone[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface Milestone {
  id: number;
  title: string;
  description: string;
  reasoning: string;
  doneCriteria: string;
  targetDate: string;
  keyRisk: string;
  contingency: string;
  completed: boolean;
  completedAt?: string;
  monthlyGoals: MonthlyGoal[];
}

export interface MonthlyGoal {
  month: number;
  title: string;
  weeklyTasks: WeeklyTask[];
}

export interface WeeklyTask {
  week: number;
  focus: string;
  dailyActions: DailyAction[];
}

export interface DailyAction {
  day: string;
  action: string;
  durationMinutes: number;
  whyToday: string;
  progressContribution: string;
}

// Daily Log
export interface DailyLog {
  id: string;
  userId: string;
  date: string;
  tasks: DailyTask[];
  heatmapEntry: HeatmapEntry;
  notificationBriefing: string;
  milestoneCelebration: MilestoneCelebration | null;
  progress: DayProgress;
  yesterdayRecap: YesterdayRecap | null;
  encouragement: string;
  mood?: MoodEntry;
  /** Whether the user has confirmed today's AI-proposed task list.
   *  When false, the tasks page shows a "Daily Plan Proposal" card
   *  that lets the user approve, regenerate, or discuss before
   *  committing to the day's plan. */
  tasksConfirmed?: boolean;
  /** AI's one-line explanation of why it chose these tasks and this
   *  cognitive budget. Shown in the proposal card. */
  adaptiveReasoning?: string;
  createdAt: string;
}

/** Where a task originated — drives CRUD lifecycle behavior */
export type TaskSource = "big_goal" | "user_created" | "calendar" | "repeating_goal";

export interface DailyTask {
  id: string;
  title: string;
  description: string;
  durationMinutes: number;
  cognitiveWeight?: 1 | 2 | 3 | 4 | 5;  // cognitive load score (1=trivial, 5=intense)
  whyToday: string;
  priority: "must-do" | "should-do" | "bonus";
  isMomentumTask: boolean;
  progressContribution: string;
  category: "learning" | "building" | "networking" | "reflection" | "planning";
  completed: boolean;
  completedAt?: string;
  startedAt?: string;       // when user started the task timer
  actualMinutes?: number;   // actual time spent (from timer)
  snoozedCount?: number;    // how many times this task was snoozed
  skipped?: boolean;        // user explicitly skipped this task
  /** Where this task came from — determines lifecycle behavior (CRUD, completion, can't-complete routing) */
  source?: TaskSource;
  /** Source goal when this task was picked from a big-goal plan tree. */
  goalId?: string | null;
  /** Source GoalPlanTask.id when this task was picked from a plan. */
  planNodeId?: string | null;
  // ── Calendar-unified fields (optional) ──
  /** Date this task is scheduled for (YYYY-MM-DD, populated by calendar view). */
  date?: string;
  /** Scheduled start time, e.g. "14:30". When set, the task appears at a
   *  specific time slot on the calendar. When absent, it's an all-day item. */
  scheduledTime?: string;
  /** Scheduled end time, e.g. "15:30". */
  scheduledEndTime?: string;
  /** True when the task has no specific time. */
  isAllDay?: boolean;
  /** Marks this task as a vacation / time-off day. */
  isVacation?: boolean;
  /** Recurrence pattern. Task shows on matching future dates. */
  recurring?: { frequency: "daily" | "weekly" | "monthly"; until?: string };
  /** Free-form notes. */
  notes?: string;
  /** Optional color override for calendar display. */
  color?: string;
  // ── Phase A: ISO time-block fields (dual-written alongside scheduledTime) ──
  /** ISO timestamptz start of the scheduled block. Preferred over `scheduledTime`
   *  for computation; legacy readers continue to use `scheduledTime`. Named with
   *  "Iso" suffix to avoid collision with the time-of-day `scheduledTime`. */
  scheduledStartIso?: string | null;
  /** ISO timestamptz end of the scheduled block. */
  scheduledEndIso?: string | null;
  /** AI-estimated duration in minutes. Distinct from user-entered `durationMinutes`. */
  estimatedDurationMinutes?: number | null;
  /** Time-block lifecycle state. */
  timeBlockStatus?: "planned" | "in_progress" | "completed" | "skipped" | null;
  /** Project grouping tag — drives the "project" calendar viewMode. */
  projectTag?: string | null;
  // ── Phase B: priority annotations (produced by priorityAnnotator agent) ──
  /** Dual-process theory — "high" = System 2 (novel/deliberative), "low" = System 1 (habitual).
   *  Internal scheduling input only; never rendered in the UI. */
  cognitiveLoad?: "high" | "medium" | "low" | null;
  /** Cognitive load theory — per-task numeric cost on a 1..10 scale. Summed against
   *  the user's `dailyCognitiveBudget` for hard-budget enforcement. */
  cognitiveCost?: number | null;
  /** Value tiering — horizon this task serves. Scheduler uses tier to pick
   *  which tasks to defer to the pending pool when over budget. */
  tier?: "lifetime" | "quarter" | "week" | "day" | null;
}

export interface HeatmapEntry {
  date: string;
  completionLevel: 0 | 1 | 2 | 3 | 4;
  currentStreak: number;
  totalActiveDays: number;
  longestStreak: number;
}

export interface MilestoneCelebration {
  milestoneTitle: string;
  milestoneId: number;
  daysTaken: number;
  tasksCompletedInMilestone: number;
  achievementSummary: string;
  nextMilestonePreview: string;
}

export interface DayProgress {
  overallPercent: number;
  milestonePercent: number;
  currentMilestone: string;
  projectedCompletion: string;
  daysAheadOrBehind: number;
}

export interface YesterdayRecap {
  completed: string[];
  missed: string[];
  missedImpact: string;
  adjustmentMade: string;
}

// Mood (opt-in)
export interface MoodEntry {
  date: string;
  level: 1 | 2 | 3 | 4 | 5;
  note?: string;
  timestamp: string;
}

// Recovery
export interface BlockerOption {
  id: string;
  label: string;
  emoji: string;
}

export interface RecoveryResponse {
  blockerAcknowledged: string;
  timelineImpact: string;
  adjustment: {
    strategy: string;
    tomorrowChanges: Array<{
      originalTask: string;
      adjustedTask: string;
      reason: string;
    }>;
    weekChanges: string;
  };
  forwardNote: string;
}

export interface PatternRestructure {
  patternDetected: {
    summary: string;
    evidence: string[];
    rootCause: string;
  };
  whatsWorking: string[];
  proposedRestructure: {
    strategy: string;
    keyChanges: Array<{
      change: string;
      reason: string;
    }>;
    oldProjectedCompletion: string;
    newProjectedCompletion: string;
    tradeoff: string;
  };
  acceptancePrompt: string;
}

// Pace Check
export interface PaceCheck {
  weekSummary: {
    tasksCompleted: number;
    tasksTotal: number;
    completionRate: string;
    strongestCategory: string;
    highlight: string;
  };
  observations: string[];
  paceQuestion: string;
  suggestedAdjustments: Array<{
    option: string;
    whatChanges: string;
    timelineImpact: string;
  }>;
  closing: string;
}

// ── Monthly Life Context ───────────────────────────────

/** User-described context for a given month that influences AI workload decisions */
export interface MonthlyContext {
  /** "YYYY-MM" format, e.g. "2026-04" */
  month: string;
  /** Free-text description of what's happening this month */
  description: string;
  /** AI-interpreted intensity level (set by AI after analyzing description) */
  intensity: "free" | "light" | "normal" | "busy" | "intense";
  /** AI-generated reasoning for the intensity classification */
  intensityReasoning: string;
  /** Capacity multiplier: 0.3 (intense) to 1.5 (free). Applied to cognitive budget. */
  capacityMultiplier: number;
  /** Max core tasks per day for this month (1-5) */
  maxDailyTasks: number;
  /** When the user last updated this context */
  updatedAt: string;
}

// App State
export type AppView =
  | "login"
  | "welcome"
  | "onboarding"
  | "dashboard"
  | "planning"
  | "tasks"
  | "calendar"
  | "goal-breakdown"
  | "roadmap"
  | "settings"
  | "news-feed"
  | "recovery"
  | "milestone-celebration"
  | `goal-plan-${string}`;  // dynamic goal plan pages

export interface AppState {
  currentView: AppView;
  user: UserProfile | null;
  roadmap: Roadmap | null;
  goalBreakdown: GoalBreakdown | null;
  goals: Goal[];
  monthlyContexts: MonthlyContext[];
  dailyLogs: DailyLog[];
  conversations: ConversationMessage[];
  isLoading: boolean;
  error: string | null;
}

// ── Goal System ─────────────────────────────────────────

/** Importance level set by user */
export type GoalImportance = "low" | "medium" | "high" | "critical";

/** AI-classified scope via NLP */
export type GoalScope = "small" | "big";

/** The three goal types that drive the user experience */
export type GoalType = "big" | "everyday" | "repeating";

/** Repeat schedule for repeating goals (classes, recurring events) */
export interface RepeatSchedule {
  frequency: "daily" | "weekly" | "biweekly" | "monthly";
  /** Days of the week (0=Sun, 1=Mon, ..., 6=Sat) */
  daysOfWeek: number[];
  /** Time of day in HH:MM format */
  timeOfDay?: string;
  /** Duration in minutes */
  durationMinutes: number;
  /** When to stop repeating (ISO date string, empty = forever) */
  until?: string;
}

/** A user-created goal */
export interface Goal {
  id: string;
  title: string;
  description: string;            // extra context the user provides for the AI
  targetDate: string;              // ISO date string, empty if habit
  isHabit: boolean;                // true = ongoing habit, no due date
  importance: GoalImportance;
  scope: GoalScope;                // NLP-determined: "small" tasks vs "big" plan goals
  goalType: GoalType;              // user-facing type: big, everyday, or repeating
  status: "pending" | "planning" | "active" | "paused" | "completed" | "archived";
  createdAt: string;
  updatedAt: string;
  /** User-chosen icon/emoji for this goal */
  icon?: string;
  /** For big goals — the planning conversation */
  planChat: GoalPlanMessage[];
  /** For big goals — the hierarchical plan the AI generated */
  plan: GoalPlan | null;
  /** For small goals — flat section-based task list */
  flatPlan: GoalPlanSection[] | null;
  /** Whether the user has confirmed the AI plan */
  planConfirmed: boolean;
  /** AI reasoning for scope classification */
  scopeReasoning: string;
  /** For repeating goals — the repeat schedule */
  repeatSchedule: RepeatSchedule | null;
  /** For everyday goals — AI-suggested time slot */
  suggestedTimeSlot?: string;
  /** For big goals — overall progress (0-100) computed from task completion */
  progressPercent?: number;
  /** Freeform notes for the goal */
  notes?: string;
  /** User has dismissed the "you have N incomplete tasks" reschedule banner for this goal */
  rescheduleBannerDismissed?: boolean;
  /** @deprecated — slot system removed. Column kept for backward compat but no longer used. */
  goalSlot?: "primary" | "secondary" | "personal" | null;
}

/** A message in the goal planning chat */
export interface GoalPlanMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

// ── Plan Edit Types ──

/** What level of the plan hierarchy is being edited */
export type PlanEditLevel = "milestone" | "year" | "month" | "week" | "day" | "task";

/** A proposed inline edit to the plan, before AI review */
export interface PlanEdit {
  /** Which level in the hierarchy */
  level: PlanEditLevel;
  /** ID of the item being edited */
  targetId: string;
  /** What field is changing (e.g. "objective", "title", "durationMinutes") */
  field: string;
  /** Previous value */
  oldValue: string;
  /** New value the user typed */
  newValue: string;
  /** Path context: parent IDs so the AI understands where this sits */
  path: { yearId?: string; monthId?: string; weekId?: string; dayId?: string };
}

/** AI's analysis of a proposed edit — returned before the user confirms */
export interface PlanEditSuggestion {
  /** Whether the AI thinks the edit is safe / recommended */
  verdict: "approve" | "caution" | "warn";
  /** 1-2 sentence explanation */
  reason: string;
  /** Optional cascading changes the AI suggests alongside this edit */
  cascadingChanges?: Array<{
    level: PlanEditLevel;
    targetId: string;
    field: string;
    suggestedValue: string;
    reason: string;
  }>;
  /** If the edit fundamentally changes the plan direction */
  requiresReplan: boolean;
}

/** Hierarchical goal plan: milestones → years → months → weeks → days */
export interface GoalPlan {
  milestones: GoalPlanMilestone[];
  years: GoalPlanYear[];
}

/** A milestone in the timeline overview */
export interface GoalPlanMilestone {
  id: string;
  title: string;
  description: string;       // 1 sentence max
  targetDate: string;         // ISO date or relative like "Month 3"
  completed: boolean;
  /** Number of tasks that fall under this milestone */
  totalTasks?: number;
  /** Number of completed tasks that fall under this milestone */
  completedTasks?: number;
}

/** Year-level objectives (only for goals > 1 year or habits) */
export interface GoalPlanYear {
  id: string;
  label: string;              // e.g. "2025" — actual year, NOT "Year 1"
  objective: string;          // 1 sentence: what to achieve this year
  months: GoalPlanMonth[];
}

/** Month-level objectives */
export interface GoalPlanMonth {
  id: string;
  label: string;              // e.g. "January 2025" — full month + year, NOT "Month 1"
  objective: string;          // 1 sentence: what to achieve this month
  weeks: GoalPlanWeek[];
}

/** Week-level plan with daily tasks */
export interface GoalPlanWeek {
  id: string;
  label: string;              // e.g. "Jan 6 – Jan 12" — date range, NOT "Week 1"
  objective: string;          // 1 sentence: what to achieve this week
  locked: boolean;            // true = future week, hidden from user
  days: GoalPlanDay[];
}

/** Day-level tasks */
export interface GoalPlanDay {
  id: string;
  label: string;              // ISO date: "2025-01-06" — NOT "Monday" or "Jan 6"
  tasks: GoalPlanTask[];
}

/** A single task within a day */
export interface GoalPlanTask {
  id: string;
  title: string;
  description: string;        // 1 sentence: why this matters for the goal
  durationMinutes: number;
  priority: "must-do" | "should-do" | "bonus";
  category: "learning" | "building" | "networking" | "reflection" | "planning";
  completed: boolean;
  completedAt?: string;
}

/** A goal plan task projected onto a calendar date range. */
export interface GoalPlanTaskForCalendar {
  id: string;
  goalId: string;
  goalTitle: string;
  goalImportance: string;
  title: string;
  description: string;
  date: string;
  durationMinutes: number;
  priority: string;
  category: string;
  completed: boolean;
  completedAt?: string;
}

// ── Legacy flat plan type (for small goals) ──

/** A flat section used for small goals with simple task lists */
export interface GoalPlanSection {
  id: string;
  title: string;
  content: string;
  order: number;
  tasks: GoalPlanTask[];
}

// ── Memory System (Three-Tier Architecture) ─────────────

/** Summary of what the AI "remembers" about the user */
export interface MemorySummary {
  totalFacts: number;
  totalPreferences: number;
  totalSignals: number;
  highConfidenceFacts: Array<{
    category: string;
    key: string;
    value: string;
  }>;
  topPreferences: Array<{
    text: string;
    sentiment: "positive" | "negative" | "neutral";
  }>;
  lastReflection: string | null;
  reflectionCount: number;
}

/** Result of running a reflection cycle */
export interface ReflectionResult {
  success: boolean;
  newInsights: number;
  proactiveQuestion: string | null;
}

/** Contextual feedback nudge — smart probes triggered by behavior */
export interface ContextualNudge {
  id: string;
  type: "early_finish" | "snooze_probe" | "missed_deadline" | "dead_zone" | "overwhelm" | "streak" | "proactive" | "pace_warning";
  message: string;
  /** Optional actions the user can take */
  actions?: Array<{
    label: string;
    feedbackValue: string;
    isPositive: boolean;
  }>;
  /** Priority for display ordering */
  priority: number;
  /** Context for recording feedback */
  context: string;
  /** Whether this nudge has been dismissed */
  dismissed?: boolean;
}

// ── Pending Task (quick-add via chat) ───────────────────

/** A task entered via the home chat that is being analyzed by AI before confirmation */
export interface PendingTask {
  id: string;
  /** The raw text the user typed */
  userInput: string;
  /** AI-generated analysis */
  analysis: {
    title: string;
    description: string;
    suggestedDate: string;       // ISO date
    durationMinutes: number;
    cognitiveWeight: 1 | 2 | 3 | 4 | 5;
    priority: "must-do" | "should-do" | "bonus";
    category: "learning" | "building" | "networking" | "reflection" | "planning";
    reasoning: string;           // why this date/duration was chosen
    conflictsWithExisting: string[];  // titles of tasks that might conflict
  } | null;
  /** Processing status */
  status: "analyzing" | "ready" | "confirmed" | "rejected";
  createdAt: string;
}

/** A daily reminder (created via chat, displayed on Tasks page) */
export interface Reminder {
  id: string;
  title: string;
  description: string;
  /** When to remind the user (ISO string) */
  reminderTime: string;
  /** Date this reminder is for (YYYY-MM-DD) */
  date: string;
  /** Whether the reminder has been acknowledged/dismissed */
  acknowledged: boolean;
  acknowledgedAt?: string;
  /** Repeat schedule: null = one-time */
  repeat: "daily" | "weekly" | "monthly" | null;
  source: "chat" | "manual";
  createdAt: string;
}

/** Interactive widget attached to a follow-up question in chat */
export type ChatWidget =
  | { type: "choices"; options: Array<{ label: string; value: string }>; resolved?: boolean }
  | { type: "date-picker"; resolved?: boolean }
  | { type: "time-picker"; resolved?: boolean }
  | { type: "datetime-picker"; resolved?: boolean };

/** Chat message on the home page */
export interface HomeChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** If this message resulted in a pending task */
  pendingTaskId?: string;
  timestamp: string;
  /** Interactive widget for follow-up questions */
  widget?: ChatWidget;
}

/** A chat session containing multiple messages */
export interface ChatSession {
  id: string;
  title: string;
  messages: HomeChatMessage[];
  createdAt: string;
  updatedAt: string;
}

/** Advisory for a single goal when the user's total active goals exceed
 *  their daily capacity. Suggests reducing frequency and extending the
 *  target date so the combined load fits the user's real pace. */
export interface OverloadAdvisory {
  goalId: string;
  goalTitle: string;
  goalImportance: string;
  currentTasksPerDay: number;
  suggestedTasksPerDay: number;
  suggestedFreqLabel: string;
  currentTargetDate: string | null;
  suggestedTargetDate: string;
  remainingTasks: number;
  totalActiveGoals: number;
}

/** Pace mismatch detected between a goal plan's assumed pace and the user's
 *  actual completion rate. Used by PaceBanner and GoalPlanPage. */
export interface PaceMismatch {
  goalId: string;
  goalTitle: string;
  planTasksPerDay: number;
  actualTasksPerDay: number;
  totalPlanTasks: number;
  completedPlanTasks: number;
  remainingTasks: number;
  daysRemaining: number;
  requiredTasksPerDay: number;
  severity: "mild" | "moderate" | "severe";
  estimatedDelayDays: number;
  /** AI-generated explanation for moderate/severe mismatches (pace explainer). */
  explanation?: string;
  /** AI-generated actionable suggestions for getting back on track. */
  suggestions?: string[];
}
