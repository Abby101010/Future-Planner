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
import { generateAndPersistDailyTasks } from "../../services/dailyTaskGeneration";
import { packageCurrentPlan, evaluateCapacity } from "./memoryPackager";
import { hydrateDailyLog } from "../../views/_mappers";
import type { DailyLog, Goal, HeatmapEntry, Reminder, TaskSource } from "@northstar/core";

// ── Types ──────────────────────────────────────────────────

export interface ScenarioResult {
  ok: boolean;
  scenario: "pool-integration" | "bonus-suggest" | "full-generation";
  /** For full-generation: task count in proposal */
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
}

// ── Router ─────────────────────────────────────────────────

export async function routeRefresh(date?: string): Promise<ScenarioResult> {
  const today = date ?? getEffectiveDate();
  const rangeStart = getEffectiveDaysAgo(90);

  const [goals, logs, tasksInRange, heatmapData, activeReminders, pooledTasks] =
    await Promise.all([
      repos.goals.list(),
      repos.dailyLogs.list(rangeStart, today),
      repos.dailyTasks.listForDateRange(rangeStart, today),
      repos.heatmap.listRange(rangeStart, today),
      repos.reminders.listActive(),
      repos.pendingTasks.listPooledForDate(today),
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

  const ctx: ScenarioContext = {
    today,
    goals,
    pastLogs,
    heatmapData,
    activeReminders,
    existingTasks,
    pooledTasks,
  };

  // Route to the appropriate scenario
  if (existingTasks.length === 0) {
    return scenarioFullGeneration(ctx);
  }
  if (pooledTasks.length > 0) {
    return scenarioPoolIntegration(ctx);
  }
  return scenarioBonusSuggest(ctx);
}

// ── Scenario 4: Full Generation (empty day) ────────────────

async function scenarioFullGeneration(
  ctx: ScenarioContext,
): Promise<ScenarioResult> {
  const { today, goals, pastLogs, heatmapData, activeReminders, pooledTasks } = ctx;

  // Feed pooled tasks as confirmedQuickTasks so the coordinator
  // incorporates them into the generated plan.
  // generateAndPersistDailyTasks will pick them up via the
  // preExistingTasks mechanism (they'll be in daily_tasks after
  // we insert them as "committed" rows before generation).

  // Pre-insert pooled tasks into daily_tasks so the generation
  // sees them as committed inputs.
  for (let i = 0; i < pooledTasks.length; i++) {
    const pt = pooledTasks[i];
    const analysis = (pt.payload.analysis ?? {}) as Record<string, unknown>;
    await repos.dailyTasks.insert({
      id: crypto.randomUUID(),
      date: today,
      title: (analysis.title as string) || pt.title || (pt.payload.userInput as string) || "Untitled",
      completed: false,
      orderIndex: i,
      source: "user_created" as TaskSource,
      payload: {
        description: (analysis.description as string) || "",
        durationMinutes: (analysis.durationMinutes as number) ?? 30,
        cognitiveWeight: (analysis.cognitiveWeight as number) ?? 3,
        priority: (analysis.priority as string) || "should-do",
        category: (analysis.category as string) || "planning",
        whyToday: (analysis.reasoning as string) || "",
        source: "pool-committed",
        pendingTaskId: pt.id,
      },
    });
    await repos.pendingTasks.updateStatus(pt.id, "confirmed");
  }

  const result = await generateAndPersistDailyTasks({
    date: today,
    goals,
    pastLogs: pastLogs as DailyLog[],
    heatmapData,
    activeReminders,
  });

  return {
    ok: true,
    scenario: "full-generation",
    taskCount: result.tasks?.length ?? 0,
    poolIntegrated: pooledTasks.length,
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

  return {
    ok: true,
    scenario: "pool-integration",
    poolIntegrated: integrated,
    overflow: overflow.length > 0 ? overflow : undefined,
    date: today,
  };
}

// ── Scenario 3b: Bonus Suggest (has tasks, no pool) ────────

async function scenarioBonusSuggest(
  ctx: ScenarioContext,
): Promise<ScenarioResult> {
  const { today, goals, pastLogs, heatmapData, activeReminders } = ctx;

  // Ask the coordinator for suggestions without persisting
  const result = await generateAndPersistDailyTasks({
    date: today,
    goals,
    pastLogs: pastLogs as DailyLog[],
    heatmapData,
    activeReminders,
    dryRun: true,
    preserveExisting: true,
  });

  const bonusSuggestions = (result.tasks ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    durationMinutes: t.durationMinutes,
    cognitiveWeight: t.cognitiveWeight,
    priority: t.priority,
    category: t.category,
    whyToday: t.whyToday,
    goalId: t.goalId,
    planNodeId: t.planNodeId,
  }));

  return {
    ok: true,
    scenario: "bonus-suggest",
    bonusSuggestions,
    date: today,
  };
}
