/* ──────────────────────────────────────────────────────────
   NorthStar — Multi-Agent Architecture Types
   Shared types for the coordinator and all subagents.
   ────────────────────────────────────────────────────────── */

/** All available agent identifiers */
export type AgentId =
  | "coordinator"
  | "research"
  | "planner"
  | "task"
  | "news";

/** Status of an individual agent during execution */
export type AgentStatus =
  | "idle"
  | "thinking"
  | "searching"
  | "analyzing"
  | "generating"
  | "done"
  | "error";

/** A single progress event streamed to the UI */
export interface AgentProgressEvent {
  agentId: AgentId;
  status: AgentStatus;
  message: string;        // human-readable status, e.g. "Searching for ML learning timelines..."
  detail?: string;        // optional longer detail (search results, reasoning steps)
  timestamp: string;
  /** 0-100, used for progress bars */
  progress?: number;
}

/** Research result from the web search agent */
export interface ResearchResult {
  query: string;
  findings: string[];      // key insights extracted
  sources: string[];       // URLs or source descriptions
  summary: string;         // integrated summary paragraph
}

/** Daily news briefing */
export interface NewsBriefing {
  date: string;
  articles: NewsArticle[];
  summary: string;
  relevanceNote: string;   // why these were picked for this user
}

export interface NewsArticle {
  title: string;
  source: string;
  url: string;
  summary: string;         // 1-2 sentence summary
  relevance: string;       // how it connects to user's goals
}

/** Peer context — what others in user's domain are doing */
export interface PeerContext {
  domain: string;
  insights: string[];
  typicalTimelines: string;
  commonMistakes: string[];
  bestPractices: string[];
}

/** Configuration for a coordinator task */
export interface CoordinatorTask {
  type: CoordinatorTaskType;
  payload: Record<string, unknown>;
  /** Whether web search should be used for this task */
  requiresResearch: boolean;
  /** Tags for memory context building */
  contextTags: string[];
}

export type CoordinatorTaskType =
  | "generate-goal-plan"
  | "goal-plan-chat"
  | "goal-plan-edit"
  | "daily-tasks"
  | "goal-breakdown"
  | "classify-goal"
  | "news-digest"
  | "onboarding"
  | "recovery"
  | "pace-check"
  | "reallocate"
  | "analyze-quick-task"
  | "analyze-monthly-context"
  | "home-chat";

/** Result envelope from the coordinator */
export interface CoordinatorResult<T = unknown> {
  success: boolean;
  data: T;
  error?: string;                     // human-readable error when success=false
  research?: ResearchResult;
  agentTrace: AgentProgressEvent[];   // full trace of what happened
  totalTokensUsed?: number;
}

/** Callback type for streaming progress to the renderer */
export type ProgressCallback = (event: AgentProgressEvent) => void;

// ── Job Queue Types ────────────────────────────────────

export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface JobRow {
  id: string;
  type: string;
  status: JobStatus;
  payload: string;       // JSON
  result: string | null;  // JSON
  error: string | null;
  progress: number;       // 0-100
  progress_log: string;   // JSON array of AgentProgressEvent
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  retry_count: number;
  max_retries: number;
}

// ── Scheduling Context Types ───────────────────────────

export interface SchedulingContext {
  availableMinutesToday: number;
  remainingCognitiveBudget: number;
  existingTaskCount: number;
  bigGoalStatus: Array<{
    title: string;
    onTrack: boolean;
    percentComplete: number;
  }>;
  recommendation: "full-load" | "light-load" | "recovery-day" | "momentum-day";
  psychologyFlags: {
    momentumOpportunity: boolean;
    recoveryNeeded: boolean;
    decisionFatigueRisk: boolean;
    overloadRisk: boolean;
  };
  unfinishedFromYesterday: Array<{
    title: string;
    category: string;
  }>;
}
