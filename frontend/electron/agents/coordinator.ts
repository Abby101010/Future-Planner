/* ──────────────────────────────────────────────────────────
   NorthStar — Central Coordinator
   
   The coordinator manages all subagents and decides:
   - Which agents to invoke for each request
   - Whether web search (research agent) is needed
   - The execution order and data flow between agents
   - Streaming progress updates to the renderer
   
   COST CONTROL — Web search is ONLY triggered at:
   1. Daily news background task (once per day)
   2. First goal setup for big goals (initial research)
   ────────────────────────────────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";
import type {
  CoordinatorTask,
  CoordinatorTaskType,
  CoordinatorResult,
  AgentProgressEvent,
  ProgressCallback,
  ResearchResult,
  SchedulingContext,
} from "./types";
import { researchGoal, getPeerContext, generateNewsBriefing } from "./research-agent";
import { loadMemory, buildMemoryContext } from "../memory";
import { evaluateSchedulingContext, formatSchedulingContext } from "./context-evaluator";
import { getMonthlyContext } from "../database";
import { getEnvironmentContext, formatEnvironmentContext } from "../environment";
import { BrowserWindow } from "electron";

/** Track whether first-time research has already been done for each goal */
const goalResearchCache = new Map<string, ResearchResult>();

/** Track the last news fetch date to enforce once-per-day */
let lastNewsFetchDate: string | null = null;

/**
 * Central coordinator — routes requests to the right subagents,
 * manages research triggers, and streams progress to the UI.
 */
export async function coordinateRequest(
  client: Anthropic,
  taskType: CoordinatorTaskType,
  payload: Record<string, unknown>,
  loadData: () => Record<string, unknown>,
  onProgress?: ProgressCallback
): Promise<CoordinatorResult> {
  const trace: AgentProgressEvent[] = [];
  const emit = (event: AgentProgressEvent) => {
    trace.push(event);
    onProgress?.(event);
  };

  emit({
    agentId: "coordinator",
    status: "thinking",
    message: "Planning approach...",
    timestamp: new Date().toISOString(),
    progress: 5,
  });

  // Determine if research is needed
  const needsResearch = shouldTriggerResearch(taskType, payload);

  // Build memory context
  const memory = loadMemory();
  const contextType = getContextType(taskType);
  const contextTags = buildContextTags(taskType, payload);
  const memoryContext = buildMemoryContext(memory, contextType, contextTags);

  let researchResult: ResearchResult | undefined;

  // Phase 1: Research (if needed)
  if (needsResearch) {
    emit({
      agentId: "coordinator",
      status: "thinking",
      message: "This goal needs research — gathering real-world data first...",
      timestamp: new Date().toISOString(),
      progress: 10,
    });

    try {
      researchResult = await runResearch(client, taskType, payload, emit);
    } catch (err) {
      emit({
        agentId: "research",
        status: "error",
        message: `Research failed: ${err instanceof Error ? err.message : "unknown error"}. Continuing without research data.`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Phase 2: Context Evaluation (for scheduling-aware tasks)
  let schedulingContext: SchedulingContext | undefined;
  let monthlyCtxCache: { intensity: string; capacityMultiplier: number; maxDailyTasks: number } | null = null;
  const schedulingTasks: CoordinatorTaskType[] = [
    "daily-tasks", "analyze-quick-task", "classify-goal", "home-chat",
  ];

  if (schedulingTasks.includes(taskType)) {
    emit({
      agentId: "coordinator",
      status: "analyzing",
      message: "Evaluating your schedule and workload...",
      timestamp: new Date().toISOString(),
      progress: needsResearch ? 50 : 15,
    });

    try {
      // Extract data from the payload that the renderer sent
      const weeklyAvailability = (payload.weeklyAvailability || []) as Array<{
        day: number; hour: number; importance: 1 | 2 | 3; label: string;
      }>;
      const todayTasks = ((payload.existingTasks || payload.confirmedQuickTasks || []) as Array<{
        title: string; completed?: boolean; durationMinutes?: number;
        cognitiveWeight?: number; category?: string; priority?: string;
      }>).map((t) => ({
        title: t.title,
        completed: t.completed ?? false,
        durationMinutes: t.durationMinutes,
        cognitiveWeight: t.cognitiveWeight,
        category: t.category,
        priority: t.priority,
      }));
      const recentLogs = (payload.pastLogs || []) as Array<{
        date: string;
        tasks: Array<{ title: string; completed: boolean; skipped?: boolean; category?: string }>;
      }>;
      const goals = (payload.goals || []) as Array<{
        title: string; goalType?: string; scope?: string; status?: string;
        percentComplete?: number; targetDate?: string;
      }>;
      const date = (payload.date as string) || new Date().toISOString().split("T")[0];

      // Fetch monthly context for the current month
      try {
        const currentMonth = date.substring(0, 7);
        const dbCtx = await getMonthlyContext(currentMonth);
        if (dbCtx) {
          monthlyCtxCache = {
            intensity: dbCtx.intensity,
            capacityMultiplier: dbCtx.capacity_multiplier,
            maxDailyTasks: dbCtx.max_daily_tasks,
          };
        }
      } catch { /* no monthly context */ }

      schedulingContext = evaluateSchedulingContext({
        weeklyAvailability,
        todayTasks,
        recentLogs,
        goals,
        date,
        monthlyContext: monthlyCtxCache,
      });

      emit({
        agentId: "coordinator",
        status: "analyzing",
        message: `Day type: ${schedulingContext.recommendation} | Budget: ${schedulingContext.remainingCognitiveBudget} | Tasks: ${schedulingContext.existingTaskCount}`,
        timestamp: new Date().toISOString(),
        progress: needsResearch ? 55 : 20,
      });
    } catch (err) {
      console.warn("[coordinator] Context evaluation failed, continuing without:", err);
    }
  }

  // Phase 3: Execute the main task with research + scheduling context injected
  emit({
    agentId: "coordinator",
    status: "generating",
    message: getTaskMessage(taskType),
    timestamp: new Date().toISOString(),
    progress: needsResearch ? 60 : 25,
  });

  try {
    const enrichedPayload: Record<string, unknown> = researchResult
      ? { ...payload, _researchContext: researchResult }
      : { ...payload };

    if (schedulingContext) {
      enrichedPayload._schedulingContext = schedulingContext;
      enrichedPayload._schedulingContextFormatted = formatSchedulingContext(schedulingContext, monthlyCtxCache);
    }

    // Inject environment context (time, location, GPS)
    try {
      const win = BrowserWindow.getAllWindows()[0] || null;
      const envCtx = await getEnvironmentContext(win);
      enrichedPayload._environmentContext = envCtx;
      enrichedPayload._environmentContextFormatted = formatEnvironmentContext(envCtx);
    } catch {
      // Environment context is best-effort
    }

    const data = await executeTask(
      client,
      taskType,
      enrichedPayload,
      memoryContext,
      loadData,
      emit
    );

    emit({
      agentId: "coordinator",
      status: "done",
      message: "Complete!",
      timestamp: new Date().toISOString(),
      progress: 100,
    });

    return {
      success: true,
      data,
      research: researchResult,
      agentTrace: trace,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "unknown error";
    console.error(`[coordinator] Task "${taskType}" failed:`, err);

    emit({
      agentId: "coordinator",
      status: "error",
      message: `Failed: ${errorMessage}`,
      timestamp: new Date().toISOString(),
    });

    return {
      success: false,
      data: null,
      error: errorMessage,
      research: researchResult,
      agentTrace: trace,
    };
  }
}

/**
 * Determine whether web search should be triggered.
 * COST CONTROL: Only at two points:
 *   1. News digest (once per day)
 *   2. First setup of a big goal (generate-goal-plan, not subsequent chats)
 */
function shouldTriggerResearch(
  taskType: CoordinatorTaskType,
  payload: Record<string, unknown>
): boolean {
  if (taskType === "news-digest") {
    const today = new Date().toISOString().split("T")[0];
    if (lastNewsFetchDate === today) return false;
    return true;
  }

  if (taskType === "generate-goal-plan") {
    const goalTitle = payload.goalTitle as string;
    // Only research on first plan generation, not re-generations
    if (goalTitle && !goalResearchCache.has(goalTitle)) {
      return true;
    }
  }

  return false;
}

/**
 * Run the research subagent appropriate for the task type.
 */
async function runResearch(
  client: Anthropic,
  taskType: CoordinatorTaskType,
  payload: Record<string, unknown>,
  emit: ProgressCallback
): Promise<ResearchResult> {
  if (taskType === "news-digest") {
    const goalTitles = (payload.goalTitles || []) as string[];
    const userInterests = (payload.userInterests || []) as string[];
    const briefing = await generateNewsBriefing(client, goalTitles, userInterests, emit);
    lastNewsFetchDate = new Date().toISOString().split("T")[0];
    return {
      query: "daily news for user goals",
      findings: briefing.articles.map(a => `${a.title}: ${a.summary}`),
      sources: briefing.articles.map(a => a.url),
      summary: briefing.summary,
    };
  }

  // Goal research
  const goalTitle = payload.goalTitle as string;
  const goalDescription = (payload.description as string) || "";
  const targetDate = (payload.targetDate as string) || "";
  const isHabit = (payload.isHabit as boolean) || false;

  emit({
    agentId: "research",
    status: "searching",
    message: `Researching real-world data for "${goalTitle}"...`,
    timestamp: new Date().toISOString(),
    progress: 15,
  });

  // Run goal research and peer context in parallel
  const [goalResearch, peerCtx] = await Promise.all([
    researchGoal(client, goalTitle, goalDescription, targetDate, isHabit, emit),
    getPeerContext(client, goalTitle, goalDescription, emit),
  ]);

  // Merge results
  const merged: ResearchResult = {
    query: goalTitle,
    findings: [
      ...goalResearch.findings,
      `Typical timeline: ${peerCtx.typicalTimelines}`,
      ...peerCtx.bestPractices.map(bp => `Best practice: ${bp}`),
      ...peerCtx.commonMistakes.map(cm => `Common mistake to avoid: ${cm}`),
    ],
    sources: goalResearch.sources,
    summary: `${goalResearch.summary}\n\nPeer Context:\n${peerCtx.insights.join("\n")}`,
  };

  // Cache so we don't re-research the same goal
  goalResearchCache.set(goalTitle, merged);

  emit({
    agentId: "research",
    status: "done",
    message: "Research complete — found realistic timelines and peer insights",
    detail: merged.summary.slice(0, 300),
    timestamp: new Date().toISOString(),
    progress: 45,
  });

  return merged;
}

/**
 * Map task type to memory context type.
 */
function getContextType(taskType: CoordinatorTaskType): "planning" | "daily" | "recovery" | "general" {
  switch (taskType) {
    case "generate-goal-plan":
    case "goal-plan-chat":
    case "goal-plan-edit":
    case "goal-breakdown":
    case "reallocate":
      return "planning";
    case "daily-tasks":
    case "analyze-quick-task":
    case "home-chat":
      return "daily";
    case "recovery":
      return "recovery";
    default:
      return "general";
  }
}

/**
 * Build context tags for memory retrieval.
 */
function buildContextTags(taskType: CoordinatorTaskType, payload: Record<string, unknown>): string[] {
  const now = new Date();
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const currentDay = dayNames[now.getDay()];
  const currentHour = now.getHours();
  const timeSlot = currentHour < 12 ? "morning" : currentHour < 17 ? "afternoon" : "evening";
  const tags = [currentDay, timeSlot];

  if (payload.blockerId) tags.push("blocker", String(payload.blockerId));
  if (payload.date) tags.push(dayNames[new Date(String(payload.date)).getDay()] || "");

  return tags;
}

/**
 * Get a user-facing message for what the coordinator is doing.
 */
function getTaskMessage(taskType: CoordinatorTaskType): string {
  switch (taskType) {
    case "generate-goal-plan": return "Building your personalized plan with research insights...";
    case "goal-plan-chat": return "Thinking about your question...";
    case "goal-plan-edit": return "Analyzing your edit...";
    case "daily-tasks": return "Preparing today's tasks...";
    case "goal-breakdown": return "Creating detailed breakdown...";
    case "classify-goal": return "Analyzing your goal...";
    case "news-digest": return "Curating your news digest...";
    case "onboarding": return "Understanding your goal...";
    case "recovery": return "Adjusting your plan...";
    case "pace-check": return "Reviewing your progress...";
    case "reallocate": return "Reallocating your schedule...";
    case "analyze-quick-task": return "Analyzing your task...";
    case "home-chat": return "Thinking...";
    default: return "Processing...";
  }
}

/**
 * Execute the actual task — delegates to the appropriate handler logic.
 * This replaces the monolithic switch in ai-handler.ts for coordinator-routed requests.
 */
async function executeTask(
  client: Anthropic,
  taskType: CoordinatorTaskType,
  payload: Record<string, unknown>,
  memoryContext: string,
  _loadData: () => Record<string, unknown>,
  emit: ProgressCallback
): Promise<unknown> {
  // Import the actual handlers from ai-handler
  // We use a dynamic import pattern to avoid circular dependencies
  const { handleAIRequestDirect } = await import("../ai-handler");

  emit({
    agentId: (taskType === "daily-tasks" || taskType === "analyze-quick-task" || taskType === "home-chat") ? "task" : "planner",
    status: "generating",
    message: taskType === "news-digest" 
      ? "Formatting your news briefing..." 
      : taskType === "analyze-quick-task"
        ? "Checking capacity and conflicts..."
        : taskType === "home-chat"
          ? "Composing response..."
          : "Generating response...",
    timestamp: new Date().toISOString(),
    progress: 70,
  });

  // For news-digest, the research agent already did all the work
  if (taskType === "news-digest") {
    const researchCtx = payload._researchContext as ResearchResult | undefined;
    return {
      date: new Date().toISOString().split("T")[0],
      articles: researchCtx?.findings || [],
      sources: researchCtx?.sources || [],
      summary: researchCtx?.summary || "No news available today.",
    };
  }

  // For all other tasks, inject research context into the payload and delegate
  const researchCtx = payload._researchContext as ResearchResult | undefined;
  const enrichedPayload = { ...payload };
  delete enrichedPayload._researchContext;

  if (researchCtx) {
    // Inject research as additional context for the AI
    enrichedPayload._researchSummary = researchCtx.summary;
    enrichedPayload._researchFindings = researchCtx.findings;
  }

  // Map coordinator task type to RequestType
  const requestType = taskType as string;

  const result = await handleAIRequestDirect(
    requestType as any,
    enrichedPayload,
    memoryContext,
    client
  );

  emit({
    agentId: (taskType === "daily-tasks" || taskType === "analyze-quick-task" || taskType === "home-chat") ? "task" : "planner",
    status: "done",
    message: "Generation complete",
    timestamp: new Date().toISOString(),
    progress: 95,
  });

  return result;
}

/**
 * Generate news briefing as a standalone operation.
 * Called from background scheduler.
 */
export async function coordinateNewsBriefing(
  client: Anthropic,
  goalTitles: string[],
  userInterests: string[],
  onProgress?: ProgressCallback
): Promise<CoordinatorResult> {
  return coordinateRequest(
    client,
    "news-digest",
    { goalTitles, userInterests },
    () => ({}),
    onProgress
  );
}

/**
 * Clear the research cache for a goal (e.g., when goal is deleted or re-planned).
 */
export function clearGoalResearchCache(goalTitle: string): void {
  goalResearchCache.delete(goalTitle);
}

/**
 * Check if we already have cached research for a goal.
 */
export function hasGoalResearch(goalTitle: string): boolean {
  return goalResearchCache.has(goalTitle);
}

/**
 * Get cached research for a goal.
 */
export function getGoalResearch(goalTitle: string): ResearchResult | undefined {
  return goalResearchCache.get(goalTitle);
}
