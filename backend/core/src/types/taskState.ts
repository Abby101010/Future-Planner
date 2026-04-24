/* ──────────────────────────────────────────────────────────
   Starward — Coordinator TaskState Types

   Central state object used by the Router-Orchestrator
   architecture. Sub-agents (Gatekeeper, TimeEstimator,
   Scheduler) populate their results into TaskState.agents,
   and the Coordinator merges them before the final AI call.
   ────────────────────────────────────────────────────────── */

// ── TaskState ───────────────────────────────────────────────

export interface TaskState {
  id: string;
  requestType: string;
  status: "pending" | "routing" | "processing" | "enriched" | "generating" | "done" | "error";
  createdAt: string;

  input: TaskStateInput;

  agents: {
    gatekeeper: GatekeeperResult | null;
    timeEstimator: TimeEstimatorResult | null;
    scheduler: SchedulerResult | null;
    priorityAnnotator: PriorityAnnotatorResult | null;
  };

  output: unknown | null;
  error: string | null;
}

export interface TaskStateInput {
  date: string;
  goals: GoalSummary[];
  scheduledTasks: ScheduledTaskSummary[];
  pastLogs: DailyLogSummary[];
  memoryContext: string;
  capacityBudget: number;
  recentCompletionRate: number;
}

// ── Summary types (lightweight versions for agent input) ────

export interface GoalSummary {
  id: string;
  title: string;
  goalType: string;
  status: string;
  targetDate: string | null;
  lastTouchedDate: string | null;
  daysSinceLastWorked: number;
  planTasksToday: CandidateTask[];
}

export interface CandidateTask {
  id: string;
  title: string;
  description: string;
  durationMinutes: number;
  priority: string;
  category: string;
  goalId: string;
  goalTitle: string;
  planNodeId: string | null;
}

export interface ScheduledTaskSummary {
  id: string;
  title: string;
  date: string;
  scheduledTime?: string;
  scheduledEndTime?: string;
  durationMinutes: number;
  category: string;
  isAllDay: boolean;
}

export interface DailyLogSummary {
  date: string;
  tasksCompleted: number;
  tasksTotal: number;
  goalIdsWorked: string[];
}

// ── Gatekeeper Result ───────────────────────────────────────

export interface GatekeeperResult {
  filteredTasks: TriagedTask[];
  priorityScores: Record<string, number>;
  budgetCheck: BudgetCheck;
  goalRotation: GoalRotation;
}

export interface TriagedTask {
  id: string;
  title: string;
  description: string;
  durationMinutes: number;
  goalId: string | null;
  goalTitle: string | null;
  planNodeId: string | null;
  priority: number;
  signal: "high" | "medium" | "low";
  cognitiveWeight: number;
  category: string;
}

export interface BudgetCheck {
  totalWeight: number;
  maxWeight: number;
  overBudget: boolean;
  tasksDropped: string[];
}

export interface GoalRotation {
  goalCount: number;
  rotationScores: Record<string, number>;
  staleGoals: string[];
}

// ── TimeEstimator Result ────────────────────────────────────

export interface TimeEstimatorResult {
  estimates: Record<string, TimeEstimate>;
  totalMinutes: number;
  exceedsDeepWorkCeiling: boolean;
}

export interface TimeEstimate {
  originalMinutes: number;
  adjustedMinutes: number;
  confidence: "low" | "medium" | "high";
  bufferMinutes: number;
}

// ── Scheduler Result ────────────────────────────────────────

export interface SchedulerResult {
  conflicts: CalendarConflict[];
  tierEnforcement: TierEnforcement;
  reshuffleProposal: ReshuffleAction[] | null;
  opportunityCost: OpportunityCost | null;
}

export interface TierEnforcement {
  calendarBlocks: ScheduleBlock[];
  goalBlocks: ScheduleBlock[];
  taskSlots: ScheduleBlock[];
}

export interface ScheduleBlock {
  startTime: string;
  endTime: string;
  label: string;
  tier: "calendar" | "goal" | "task";
  durationMinutes: number;
  goalId?: string;
}

export interface CalendarConflict {
  taskId: string;
  eventTitle: string;
  overlapMinutes: number;
  resolution: "defer" | "shorten" | "move";
}

export interface ReshuffleAction {
  taskId: string;
  action: "keep" | "defer" | "swap" | "drop";
  reason: string;
}

export interface OpportunityCost {
  weeklyHoursRequired: number;
  affectedGoals: Array<{
    goalId: string;
    title: string;
    currentWeeklyHours: number;
    projectedWeeklyHours: number;
    reductionPercent: number;
  }>;
  deepWorkImpact: {
    currentDailyMinutes: number;
    projectedDailyMinutes: number;
  };
  warning: string | null;
}

// ── PriorityAnnotator Result (Phase B) ──────────────────────

export interface PriorityAnnotation {
  cognitiveLoad: "high" | "medium" | "low";
  cognitiveCost: number;            // 1..10
  tier: "lifetime" | "quarter" | "week" | "day";
  rationale: string;
}

export interface PriorityAnnotatorResult {
  /** Keyed by taskId. Empty map when the agent is skipped or fails — callers
   *  must tolerate missing entries and fall back to pre-Phase-B behaviour. */
  annotations: Record<string, PriorityAnnotation>;
}

// ── Agent routing ───────────────────────────────────────────

export type SubAgentId =
  | "gatekeeper"
  | "timeEstimator"
  | "scheduler"
  | "priorityAnnotator";

export interface AgentPlan {
  agents: SubAgentId[];
  parallel: SubAgentId[][];
  sequential: SubAgentId[];
  /** HiTAMP dependency graph — which agents depend on which. Informational
   *  for now, enables future retraction decisions. */
  dependencies?: Partial<Record<SubAgentId, SubAgentId[]>>;
}
