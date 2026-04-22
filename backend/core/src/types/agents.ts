/* ──────────────────────────────────────────────────────────
   NorthStar — Agent Types (Frontend)
   Shared types for multi-agent progress display.
   ────────────────────────────────────────────────────────── */

/** All available agent identifiers */
export type AgentId =
  | "coordinator"
  | "research"
  | "planner"
  | "task"
  | "news"
  | "gatekeeper"
  | "timeEstimator"
  | "scheduler";

/** Status of an individual agent during execution */
export type AgentStatus =
  | "idle"
  | "thinking"
  | "searching"
  | "analyzing"
  | "generating"
  | "done"
  | "error";

/** A single progress event streamed from the backend */
export interface AgentProgressEvent {
  agentId: AgentId;
  status: AgentStatus;
  message: string;
  detail?: string;
  timestamp: string;
  progress?: number;
}

/** News article in a briefing */
export interface NewsArticle {
  title: string;
  source: string;
  url: string;
  summary: string;
  relevance: string;
}

/** Daily news briefing */
export interface NewsBriefing {
  date: string;
  articles: NewsArticle[];
  summary: string;
  relevanceNote: string;
}
