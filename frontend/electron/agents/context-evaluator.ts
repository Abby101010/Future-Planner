/* ──────────────────────────────────────────────────────────
   NorthStar — Scheduling Context Evaluator

   Called by the coordinator BEFORE task execution.
   Evaluates user context (time, workload, goals, psychology)
   to produce a SchedulingContext that guides task allocation.
   ────────────────────────────────────────────────────────── */

import type { SchedulingContext } from "./types";

/** A time block from the weekly availability grid */
interface TimeBlock {
  day: number;        // 0=Mon ... 6=Sun
  hour: number;       // 0-23
  importance: 1 | 2 | 3;
  label: string;
}

/** A daily task (subset of DailyTask) */
interface TaskInfo {
  title: string;
  completed: boolean;
  skipped?: boolean;
  durationMinutes?: number;
  cognitiveWeight?: number;
  category?: string;
  priority?: string;
}

/** A daily log entry */
interface DailyLogInfo {
  date: string;
  tasks: TaskInfo[];
}

/** A big goal summary */
interface GoalInfo {
  title: string;
  goalType?: string;
  scope?: string;
  status?: string;
  percentComplete?: number;
  targetDate?: string;
}

// ── Constants ──────────────────────────────────────────

const MAX_COGNITIVE_BUDGET = 12;
const MAX_DAILY_TASKS = 5;         // Miller's Law: 3-5 tasks
const DEEP_WORK_CEILING_MIN = 180; // 3 hours
const RECOVERY_THRESHOLD = 0.4;    // <40% completion → recovery
const MOMENTUM_THRESHOLD = 0.8;    // >80% completion → momentum

// ── Main Evaluator ─────────────────────────────────────

export function evaluateSchedulingContext(opts: {
  weeklyAvailability: TimeBlock[];
  todayTasks: TaskInfo[];
  recentLogs: DailyLogInfo[];
  goals: GoalInfo[];
  date: string;
  monthlyContext?: { intensity: string; capacityMultiplier: number; maxDailyTasks: number } | null;
}): SchedulingContext {
  const { weeklyAvailability, todayTasks, recentLogs, goals, date, monthlyContext } = opts;

  // Adjust limits based on monthly context
  const effectiveMaxTasks = monthlyContext?.maxDailyTasks ?? MAX_DAILY_TASKS;
  const effectiveBudget = monthlyContext
    ? Math.max(4, Math.round(MAX_COGNITIVE_BUDGET * monthlyContext.capacityMultiplier))
    : MAX_COGNITIVE_BUDGET;

  // 1. Compute available minutes today from weekly grid
  const todayDate = new Date(date);
  // JS getDay(): 0=Sun, TimeBlock.day: 0=Mon → convert
  const jsDow = todayDate.getDay();
  const gridDow = jsDow === 0 ? 6 : jsDow - 1; // convert to 0=Mon
  const todayBlocks = weeklyAvailability.filter((b) => b.day === gridDow);
  const availableMinutesToday = todayBlocks.length * 60; // each block = 1 hour

  // 2. Compute current workload & remaining cognitive budget
  const existingTaskCount = todayTasks.length;
  const usedCognitiveBudget = todayTasks.reduce(
    (sum, t) => sum + (t.cognitiveWeight || 2), 0
  );
  const remainingCognitiveBudget = Math.max(0, effectiveBudget - usedCognitiveBudget);

  // 3. Big goal progress status
  const bigGoalStatus = goals
    .filter((g) => g.goalType === "big" || g.scope === "big")
    .map((g) => {
      const pct = g.percentComplete ?? 0;
      let onTrack = true;
      if (g.targetDate) {
        const now = Date.now();
        const target = new Date(g.targetDate).getTime();
        const total = target - now;
        if (total > 0 && pct < 100) {
          // Simple check: expected progress based on time elapsed
          const created = now - 30 * 86_400_000; // rough estimate
          const elapsed = now - created;
          const expectedPct = (elapsed / (target - created)) * 100;
          onTrack = pct >= expectedPct * 0.7; // 70% of expected is "on track"
        }
      }
      return { title: g.title, onTrack, percentComplete: pct };
    });

  // 4. Recent completion rate (last 7 days)
  const last7Days = recentLogs.filter((log) => {
    const diff = Date.now() - new Date(log.date).getTime();
    return diff <= 7 * 86_400_000;
  });

  let totalAssigned = 0;
  let totalCompleted = 0;
  for (const log of last7Days) {
    totalAssigned += log.tasks.length;
    totalCompleted += log.tasks.filter((t) => t.completed).length;
  }
  const completionRate = totalAssigned > 0
    ? totalCompleted / totalAssigned
    : -1; // no data

  // 5. Psychology flags
  const recoveryNeeded = completionRate >= 0 && completionRate < RECOVERY_THRESHOLD;
  const momentumOpportunity = completionRate >= MOMENTUM_THRESHOLD;
  const overloadRisk = existingTaskCount >= effectiveMaxTasks ||
    usedCognitiveBudget >= effectiveBudget;
  const decisionFatigueRisk = existingTaskCount >= effectiveMaxTasks + 2;

  // 6. Determine recommendation
  let recommendation: SchedulingContext["recommendation"] = "full-load";
  if (recoveryNeeded) {
    recommendation = "recovery-day";
  } else if (momentumOpportunity) {
    recommendation = "momentum-day";
  } else if (overloadRisk) {
    recommendation = "light-load";
  }

  // 7. Unfinished tasks from yesterday (Zeigarnik effect)
  const yesterday = new Date(todayDate);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];
  const yesterdayLog = recentLogs.find((l) => l.date === yesterdayStr);
  const unfinishedFromYesterday = (yesterdayLog?.tasks || [])
    .filter((t) => !t.completed && !t.skipped)
    .map((t) => ({
      title: t.title,
      category: t.category || "general",
    }));

  return {
    availableMinutesToday,
    remainingCognitiveBudget,
    existingTaskCount,
    bigGoalStatus,
    recommendation,
    psychologyFlags: {
      momentumOpportunity,
      recoveryNeeded,
      decisionFatigueRisk,
      overloadRisk,
    },
    unfinishedFromYesterday,
  };
}

/**
 * Format the scheduling context as a human-readable string
 * to inject into AI prompts.
 */
export function formatSchedulingContext(ctx: SchedulingContext, monthlyContext?: { intensity: string; capacityMultiplier: number; maxDailyTasks: number } | null): string {
  const effectiveBudget = monthlyContext
    ? Math.max(4, Math.round(MAX_COGNITIVE_BUDGET * monthlyContext.capacityMultiplier))
    : MAX_COGNITIVE_BUDGET;
  const effectiveMaxTasks = monthlyContext?.maxDailyTasks ?? MAX_DAILY_TASKS;

  const lines: string[] = [
    "=== SCHEDULING CONTEXT ===",
    `Available time today: ${ctx.availableMinutesToday} minutes`,
    `Remaining cognitive budget: ${ctx.remainingCognitiveBudget}/${effectiveBudget}`,
    `Existing tasks today: ${ctx.existingTaskCount}`,
    `Day type: ${ctx.recommendation}`,
  ];

  if (monthlyContext) {
    lines.push(`Monthly intensity: ${monthlyContext.intensity} (${monthlyContext.capacityMultiplier}x capacity, max ${monthlyContext.maxDailyTasks} tasks)`);
  }

  if (ctx.psychologyFlags.recoveryNeeded) {
    lines.push("⚠ RECOVERY MODE: User has <40% completion rate — assign only 2 easy tasks");
  }
  if (ctx.psychologyFlags.momentumOpportunity) {
    lines.push("✓ MOMENTUM: User has >80% completion rate — start with a quick win, can handle full load");
  }
  if (ctx.psychologyFlags.overloadRisk) {
    lines.push("⚠ OVERLOAD RISK: Task count or cognitive budget at limit — new tasks should be bonus only");
  }
  if (ctx.psychologyFlags.decisionFatigueRisk) {
    lines.push("⚠ DECISION FATIGUE: Too many tasks — do not add more unless critical");
  }

  if (ctx.bigGoalStatus.length > 0) {
    lines.push("\nBig Goal Progress:");
    for (const g of ctx.bigGoalStatus) {
      const status = g.onTrack ? "on track" : "BEHIND";
      lines.push(`  - ${g.title}: ${g.percentComplete}% (${status})`);
    }
  }

  if (ctx.unfinishedFromYesterday.length > 0) {
    lines.push("\nUnfinished from yesterday (Zeigarnik — consider including one):");
    for (const t of ctx.unfinishedFromYesterday) {
      lines.push(`  - ${t.title} [${t.category}]`);
    }
  }

  lines.push(
    "\nPSYCHOLOGY RULES:",
    `- Miller's Law: cap daily tasks at ${effectiveMaxTasks}`,
    "- Deep work ceiling: max 3 hours of focused work",
    `- Cognitive budget: max ${effectiveBudget} points (weight 1-5 per task)`,
    "- Spacing effect: vary task categories, don't cluster similar tasks",
    "- Peak-End Rule: end the day with a satisfying task",
    "=========================",
  );

  return lines.join("\n");
}
