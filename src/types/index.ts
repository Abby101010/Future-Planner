/* NorthStar - shared type definitions */

// User
export interface UserProfile {
  id: string;
  name: string;
  age?: number;
  currentRole?: string;
  education?: string;
  location?: string;
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

export interface UserSettings {
  enableNewsFeed: boolean;
  dailyReminderTime?: string;
  theme: "light" | "dark" | "system";
  language: "en" | "zh";
  apiKey?: string;
  modelOverrides?: Partial<Record<"heavy" | "medium" | "light", string>>;
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
  createdAt: string;
}

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

// ── In-App Calendar ─────────────────────────────────────

/** A single event/block created by the user in the NorthStar calendar */
export interface CalendarEvent {
  id: string;
  title: string;
  startDate: string; // ISO string
  endDate: string;   // ISO string
  isAllDay: boolean;
  durationMinutes: number;
  category: "work" | "personal" | "health" | "social" | "travel" | "focus" | "other";
  isVacation: boolean;
  /** Which source created this event */
  source: "manual" | "device-calendar" | "device-reminders";
  /** Name of the originating calendar (e.g. "Work", "Personal") */
  sourceCalendar?: string;
  color?: string;
  notes?: string;
  recurring?: {
    frequency: "daily" | "weekly" | "monthly";
    until?: string;
  };
}

/** Which device integrations the user has opted in to */
export interface DeviceIntegrations {
  /** macOS/iOS Calendar.app */
  calendar: {
    enabled: boolean;
    /** e.g. ["Work", "Personal"] — only import from these */
    selectedCalendars: string[];
    /** When we last synced */
    lastSynced?: string;
  };
  /** macOS Reminders — future */
  reminders: {
    enabled: boolean;
    selectedLists: string[];
    lastSynced?: string;
  };
  // extensible: add screenTime, healthKit, etc. later
}

// Calendar schedule summary (used by AI)
export interface CalendarSchedule {
  days: Array<{
    date: string;
    busyMinutes: number;
    freeMinutes: number;
    isVacation: boolean;
    isWeekend: boolean;
    events: Array<{
      title: string;
      startDate: string;
      endDate: string;
      isAllDay: boolean;
      durationMinutes: number;
    }>;
  }>;
  vacationPeriods: Array<{ start: string; end: string; label: string }>;
  averageFreeMinutesWeekday: number;
  averageFreeMinutesWeekend: number;
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
  calendarEvents: CalendarEvent[];
  deviceIntegrations: DeviceIntegrations;
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
  status: "pending" | "planning" | "active" | "completed" | "archived";
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
  label: string;              // e.g. "Year 1" or "2025"
  objective: string;          // 1 sentence: what to achieve this year
  months: GoalPlanMonth[];
}

/** Month-level objectives */
export interface GoalPlanMonth {
  id: string;
  label: string;              // e.g. "Month 1" or "January 2025"
  objective: string;          // 1 sentence: what to achieve this month
  weeks: GoalPlanWeek[];
}

/** Week-level plan with daily tasks */
export interface GoalPlanWeek {
  id: string;
  label: string;              // e.g. "Week 1" or "Jan 6 – Jan 12"
  objective: string;          // 1 sentence: what to achieve this week
  locked: boolean;            // true = future week, hidden from user
  days: GoalPlanDay[];
}

/** Day-level tasks */
export interface GoalPlanDay {
  id: string;
  label: string;              // e.g. "Monday" or "Jan 6"
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
  type: "early_finish" | "snooze_probe" | "missed_deadline" | "dead_zone" | "overwhelm" | "streak" | "proactive";
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

/** Chat message on the home page */
export interface HomeChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** If this message resulted in a pending task */
  pendingTaskId?: string;
  timestamp: string;
}

/** A chat session containing multiple messages */
export interface ChatSession {
  id: string;
  title: string;
  messages: HomeChatMessage[];
  createdAt: string;
  updatedAt: string;
}
