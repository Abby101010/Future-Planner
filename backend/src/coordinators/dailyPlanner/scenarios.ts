/**
 * Daily Planner Coordinator — Scenario Router
 *
 * Clean separation of five scenarios for the daily plan lifecycle.
 * Each scenario is its own function; the router inspects state and delegates.
 *
 * Scenario 1: Mid-day task add → handled by cmdCreatePendingTask (pool)
 * Scenario 2: Big goal modified → implicit (sits until refresh)
 * Scenario 3a: Refresh + pool tasks → scenarioPoolIntegration
 * Scenario 3b: Refresh + no pool → scenarioBonusSuggest
 * Scenario 4: Refresh + empty day → scenarioFullGeneration
 * Scenario 5: Day rollover → handled by pendingReschedules in tasksView
 */

import * as repos from "../../repositories";
import type { PendingTaskRecord } from "../../repositories/pendingTasksRepo";
import type { DailyTaskRecord } from "../../repositories/dailyTasksRepo";
import { getEffectiveDate, getEffectiveDaysAgo } from "../../dateUtils";
import { packageCurrentPlan, evaluateCapacity } from "./memoryPackager";
import { hydrateDailyLog } from "../../views/_mappers";
import { loadMemory, computeCapacityProfile } from "../../memory";
import { getCurrentUserId } from "../../middleware/requestContext";
import type { DailyLog, Goal, HeatmapEntry, Reminder, TaskSource } from "@northstar/core";
import { COGNITIVE_BUDGET, computeCognitiveWeight, checkOverload } from "@northstar/core";
import type { DeferralRecommendation } from "@northstar/core";

// ── Types ──────────────────────────────────────────────────

export interface ScenarioResult {
  ok: boolean;
  scenario: "pool-integration" | "bonus-suggest" | "full-generation" | "collect-and-schedule";
  /** For collect-and-schedule / full-generation: task count inserted */
  taskCount?: number;
  /** For bonus-suggest: the bonus suggestions */
  bonusSuggestions?: Array<Record<string, unknown>>;
  /** How many pool tasks were integrated */
  poolIntegrated?: number;
  /** Pool tasks that didn't fit (capacity exceeded) */
  overflow?: Array<{
    title: string;
    cognitiveWeight: number;
    durationMinutes: number;
    reason: string;
    deferCandidates: Array<{ id: string; title: string; cognitiveWeight: number }>;
  }>;
  /** Cross-goal deferral recommendations when total load exceeds budget */
  deferralRecommendations?: DeferralRecommendation[];
  /** Budget summary after collecting all tasks */
  budgetSummary?: {
    totalWeight: number;
    maxWeight: number;
    totalTasks: number;
    maxTasks: number;
    overloaded: boolean;
    goalBreakdown: Array<{ goalId: string; goalTitle: string; taskCount: number; totalWeight: number }>;
  };
  date: string;
}

interface ScenarioContext {
  today: string;
  goals: Goal[];
  pastLogs: DailyLog[];
  heatmapData: HeatmapEntry[];
  activeReminders: Reminder[];
  existingTasks: DailyTaskRecord[];
  pooledTasks: PendingTaskRecord[];
  /** Effective daily weight budget (from capacity profile + weekly availability) */
  effectiveMaxWeight: number;
  /** Effective daily task count limit */
  effectiveMaxTasks: number;
}

// ── Router ─────────────────────────────────────────────────

export async function routeRefresh(date?: string): Promise<ScenarioResult> {
  const today = date ?? getEffectiveDate();
  const rangeStart = getEffectiveDaysAgo(90);

  const userId = getCurrentUserId();
  const [goals, logs, tasksInRange, heatmapData, activeReminders, pooledTasks, memory, user] =
    await Promise.all([
      repos.goals.list(),
      repos.dailyLogs.list(rangeStart, today),
      repos.dailyTasks.listForDateRange(rangeStart, today),
      repos.heatmap.listRange(rangeStart, today),
      repos.reminders.listActive(),
      repos.pendingTasks.listPooledForDate(today),
      loadMemory(userId),
      repos.users.get(),
    ]);

  // Build past logs for the coordinator
  const tasksByDate = new Map<string, DailyTaskRecord[]>();
  for (const t of tasksInRange) {
    const arr = tasksByDate.get(t.date) ?? [];
    arr.push(t);
    tasksByDate.set(t.date, arr);
  }
  const pastLogs = logs
    .filter((l) => l.date !== today)
    .map((l) => hydrateDailyLog(l, tasksByDate.get(l.date) ?? []))
    .slice(0, 14);

  const existingTasks = tasksByDate.get(today) ?? [];

  // Compute capacity profile with weekly availability
  const logsForCapacity = pastLogs.map((l) => ({
    date: l.date,
    tasks: l.tasks.map((t) => ({ completed: t.completed, skipped: !!t.skipped })),
  }));
  const capacity = computeCapacityProfile(
    memory, logsForCapacity, new Date(today + "T00:00:00").getDay(),
    undefined, user?.weeklyAvailability,
  );

  const ctx: ScenarioContext = {
    today,
    goals,
    pastLogs,
    heatmapData,
    activeReminders,
    existingTasks,
    pooledTasks,
    effectiveMaxWeight: capacity.capacityBudget,
    effectiveMaxTasks: capacity.maxDailyTasks ?? COGNITIVE_BUDGET.MAX_DAILY_TASKS,
  };

  // Route to the appropriate scenario
  if (existingTasks.length === 0) {
    return scenarioCollectAndSchedule(ctx);
  }
  if (pooledTasks.length > 0) {
    return scenarioPoolIntegration(ctx);
  }
  return scenarioBonusSuggest(ctx);
}

// ── Scenario 4: Collect & Schedule (empty day) ────────────
//
// Deterministically collects tasks from ALL existing sources (user-created
// pool tasks + goal plan tasks scheduled for today) and inserts them
// into daily_tasks. NO AI invention — the coordinator only organises
// what the user already created or what the confirmed goal plan has
// scheduled for this date.
//
// After inserting ALL tasks, runs cross-goal budget analysis. If the
// combined load exceeds the cognitive budget, it attaches deferral
// RECOMMENDATIONS (not deletions) — the user decides what stays.

async function scenarioCollectAndSchedule(
  ctx: ScenarioContext,
): Promise<ScenarioResult> {
  const { today, pooledTasks, goals } = ctx;

  let orderIdx = 0;
  // Track all inserted tasks for cross-goal budget analysis
  const inserted: Array<{
    id: string;
    title: string;
    goalId: string | null;
    goalTitle: string;
    cognitiveWeight: number;
    durationMinutes: number;
    priority: string;
    source: string;
  }> = [];

  // 1. Pre-insert pooled tasks (user-created via chat / quick-add)
  for (const pt of pooledTasks) {
    const analysis = (pt.payload.analysis ?? {}) as Record<string, unknown>;
    const taskId = crypto.randomUUID();
    const weight = (analysis.cognitiveWeight as number) ?? 3;
    const minutes = (analysis.durationMinutes as number) ?? 30;
    const priority = (analysis.priority as string) || "should-do";
    await repos.dailyTasks.insert({
      id: taskId,
      date: today,
      title: (analysis.title as string) || pt.title || (pt.payload.userInput as string) || "Untitled",
      completed: false,
      orderIndex: orderIdx++,
      source: "user_created" as TaskSource,
      payload: {
        description: (analysis.description as string) || "",
        durationMinutes: minutes,
        cognitiveWeight: weight,
        priority,
        category: (analysis.category as string) || "planning",
        whyToday: (analysis.reasoning as string) || "",
        source: "pool-committed",
        pendingTaskId: pt.id,
      },
    });
    await repos.pendingTasks.updateStatus(pt.id, "confirmed");
    inserted.push({
      id: taskId,
      title: (analysis.title as string) || pt.title || "Untitled",
      goalId: null,
      goalTitle: "User Tasks",
      cognitiveWeight: weight,
      durationMinutes: minutes,
      priority,
      source: "pool",
    });
  }

  // 2. Collect goal plan tasks scheduled for today that aren't already
  //    in daily_tasks (dedup by plan node id).
  const goalPlanTasks = await repos.goalPlan.listTasksForDateRange(today, today);
  const existingPlanNodeIds = new Set(
    (await repos.dailyTasks.listForDate(today))
      .map((t) => t.planNodeId)
      .filter(Boolean),
  );
  const goalMap = new Map(goals.map((g) => [g.id, g.title]));

  let goalTasksInserted = 0;
  for (const gpt of goalPlanTasks) {
    if (existingPlanNodeIds.has(gpt.id)) continue;
    if (gpt.completed) continue;
    const taskId = crypto.randomUUID();
    const minutes = gpt.durationMinutes ?? 30;
    const priority = gpt.priority || "should-do";
    const goalImportance = gpt.goalImportance ?? "medium";
    const weight = computeCognitiveWeight(goalImportance, minutes, priority);
    await repos.dailyTasks.insert({
      id: taskId,
      date: today,
      goalId: gpt.goalId,
      planNodeId: gpt.id,
      title: gpt.title,
      completed: false,
      orderIndex: orderIdx++,
      source: "big_goal" as TaskSource,
      payload: {
        description: gpt.description || "",
        durationMinutes: minutes,
        cognitiveWeight: weight,
        priority,
        category: gpt.category || "planning",
        whyToday: `Scheduled in goal plan for ${today}`,
      },
    });
    goalTasksInserted++;
    inserted.push({
      id: taskId,
      title: gpt.title,
      goalId: gpt.goalId,
      goalTitle: goalMap.get(gpt.goalId) ?? gpt.goalTitle ?? "Unknown Goal",
      cognitiveWeight: weight,
      durationMinutes: minutes,
      priority,
      source: "big_goal",
    });
  }

  // 3. Cross-goal budget analysis — recommend deferrals if overloaded.
  //    ALL tasks are already inserted (user sees full picture).
  //    Recommendations are advisory — user decides what to act on.
  const maxWeight = ctx.effectiveMaxWeight;
  const maxTasks = ctx.effectiveMaxTasks;

  const overloadResult = checkOverload(
    inserted.map((t) => ({
      id: t.id,
      title: t.title,
      goalId: t.goalId,
      goalTitle: t.goalTitle,
      cognitiveWeight: t.cognitiveWeight,
      durationMinutes: t.durationMinutes,
      priority: t.priority,
    })),
    maxWeight,
    maxTasks,
  );

  const { overloaded, totalWeight, totalTasks, goalBreakdown } = overloadResult;
  const deferralRecommendations = overloadResult.deferralRecommendations.length
    ? overloadResult.deferralRecommendations
    : undefined;

  // Record overload signal for TextGrad feedback loop
  if (overloaded && deferralRecommendations?.length) {
    const { recordOverloadDetected } = await import("../../services/signalRecorder");
    recordOverloadDetected(
      `${today}: ${totalWeight}/${maxWeight} weight, ${totalTasks}/${maxTasks} tasks`,
      deferralRecommendations.length,
    ).catch(() => {});
  }

  // 4. Create a daily log entry for the day
  const totalInserted = pooledTasks.length + goalTasksInserted;
  if (totalInserted > 0) {
    const reasoning = overloaded
      ? `Collected ${pooledTasks.length} user task(s) and ${goalTasksInserted} goal plan task(s) for today. ` +
        `Day is overloaded (${totalWeight}/${maxWeight} weight, ${totalTasks}/${maxTasks} tasks) — ` +
        `${deferralRecommendations?.length ?? 0} deferral(s) recommended.`
      : `Collected ${pooledTasks.length} user task(s) and ${goalTasksInserted} goal plan task(s) for today.`;
    await repos.dailyLogs.upsert({
      date: today,
      payload: {
        tasksConfirmed: false,
        adaptiveReasoning: reasoning,
      },
    });
  }

  return {
    ok: true,
    scenario: "collect-and-schedule",
    taskCount: totalInserted,
    poolIntegrated: pooledTasks.length,
    deferralRecommendations: deferralRecommendations?.length ? deferralRecommendations : undefined,
    budgetSummary: {
      totalWeight,
      maxWeight,
      totalTasks,
      maxTasks,
      overloaded,
      goalBreakdown,
    },
    date: today,
  };
}

// ── Scenario 3a: Pool Integration (has tasks + has pool) ───

async function scenarioPoolIntegration(
  ctx: ScenarioContext,
): Promise<ScenarioResult> {
  const { today, pooledTasks } = ctx;

  let integrated = 0;
  const overflow: ScenarioResult["overflow"] = [];

  for (const pt of pooledTasks) {
    const analysis = (pt.payload.analysis ?? {}) as Record<string, unknown>;
    const weight = (analysis.cognitiveWeight as number) ?? 3;
    const minutes = (analysis.durationMinutes as number) ?? 30;

    // Use memory packager for lightweight capacity check
    const pkg = await packageCurrentPlan(today);
    const capacity = evaluateCapacity(pkg, weight, minutes);

    if (capacity.ok) {
      // Fits — insert directly into daily_tasks
      await repos.dailyTasks.insert({
        id: crypto.randomUUID(),
        date: today,
        title: (analysis.title as string) || pt.title || (pt.payload.userInput as string) || "Untitled",
        completed: false,
        orderIndex: pkg.existingTasks.length,
        source: "user_created" as TaskSource,
        payload: {
          description: (analysis.description as string) || "",
          durationMinutes: minutes,
          cognitiveWeight: weight,
          priority: (analysis.priority as string) || "should-do",
          category: (analysis.category as string) || "planning",
          whyToday: (analysis.reasoning as string) || "",
          source: "pool-integrated",
          pendingTaskId: pt.id,
        },
      });
      await repos.pendingTasks.updateStatus(pt.id, "confirmed");
      integrated++;
    } else {
      // Doesn't fit — collect as overflow
      overflow!.push({
        title: (analysis.title as string) || pt.title,
        cognitiveWeight: weight,
        durationMinutes: minutes,
        reason: capacity.reason || "Over budget",
        deferCandidates: (capacity.deferCandidates ?? []).map((c) => ({
          id: c.id,
          title: c.title,
          cognitiveWeight: c.cognitiveWeight,
        })),
      });
    }
  }

  // Ensure a daily_log exists so the view surfaces the integrated tasks.
  if (integrated > 0) {
    await repos.dailyLogs.ensureExists(today);
  }

  return {
    ok: true,
    scenario: "pool-integration",
    poolIntegrated: integrated,
    overflow: overflow.length > 0 ? overflow : undefined,
    date: today,
  };
}

// ── Scenario 3b: Bonus Suggest (has tasks, no pool) ────────
//
// When the day already has tasks and there are no pending pool items,
// suggest unclaimed goal plan tasks for today that the user can
// optionally add. No AI call — just a deterministic lookup.

async function scenarioBonusSuggest(
  ctx: ScenarioContext,
): Promise<ScenarioResult> {
  const { today, goals } = ctx;

  // Find goal plan tasks for today not yet in daily_tasks
  const goalPlanTasks = await repos.goalPlan.listTasksForDateRange(today, today);
  const existingTasks = await repos.dailyTasks.listForDate(today);
  const existingPlanNodeIds = new Set(
    existingTasks
      .map((t) => t.planNodeId)
      .filter(Boolean),
  );

  const candidates = goalPlanTasks
    .filter((gpt) => !existingPlanNodeIds.has(gpt.id) && !gpt.completed);

  if (candidates.length === 0) {
    return { ok: true, scenario: "bonus-suggest", bonusSuggestions: [], date: today };
  }

  // Compute remaining cognitive budget from active (non-completed, non-skipped) tasks
  const activeTasks = existingTasks.filter(
    (t) => !t.completed && !t.payload?.skipped,
  );
  const currentWeight = activeTasks.reduce(
    (s, t) => s + ((t.payload?.cognitiveWeight as number) ?? 3), 0,
  );
  const currentCount = activeTasks.length;
  const maxWeight = ctx.effectiveMaxWeight;
  const maxTasks = ctx.effectiveMaxTasks;
  const remainingWeight = Math.max(0, maxWeight - currentWeight);
  const remainingSlots = Math.max(0, maxTasks - currentCount);

  // Auto-insert tasks that fit within the remaining budget
  const goalMap = new Map(goals.map((g) => [g.id, g.title]));
  let usedWeight = 0;
  let usedSlots = 0;
  let orderIdx = existingTasks.length;
  let autoInserted = 0;
  const bonusSuggestions: Array<Record<string, unknown>> = [];

  for (const gpt of candidates) {
    const minutes = gpt.durationMinutes ?? 30;
    const priority = gpt.priority || "should-do";
    const goalImportance = gpt.goalImportance ?? "medium";
    const weight = computeCognitiveWeight(goalImportance, minutes, priority);

    if (usedSlots < remainingSlots && usedWeight + weight <= remainingWeight) {
      // Auto-insert — fits within budget
      const taskId = crypto.randomUUID();
      await repos.dailyTasks.insert({
        id: taskId,
        date: today,
        goalId: gpt.goalId,
        planNodeId: gpt.id,
        title: gpt.title,
        completed: false,
        orderIndex: orderIdx++,
        source: "big_goal" as TaskSource,
        payload: {
          description: gpt.description || "",
          durationMinutes: minutes,
          cognitiveWeight: weight,
          priority,
          category: gpt.category || "planning",
          whyToday: `Scheduled in goal plan for ${today}`,
        },
      });
      usedWeight += weight;
      usedSlots++;
      autoInserted++;
    } else {
      // Over budget — suggest instead
      bonusSuggestions.push({
        id: gpt.id,
        title: gpt.title,
        description: gpt.description,
        durationMinutes: minutes,
        cognitiveWeight: weight,
        priority,
        category: gpt.category,
        whyToday: `Scheduled in goal plan for ${today}`,
        goalId: gpt.goalId,
        planNodeId: gpt.id,
      });
    }
  }

  // Ensure a daily_log exists so the view surfaces the auto-inserted tasks.
  if (autoInserted > 0) {
    await repos.dailyLogs.ensureExists(today);
  }

  return {
    ok: true,
    scenario: "bonus-suggest",
    taskCount: autoInserted,
    bonusSuggestions: bonusSuggestions.length ? bonusSuggestions : undefined,
    date: today,
  };
}
