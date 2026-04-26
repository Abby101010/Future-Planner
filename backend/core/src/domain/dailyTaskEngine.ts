/**
 * Daily Task Rule Engine — Deterministic Task Selection & Scoring
 *
 * Replaces the 3 AI sub-agent calls (gatekeeper + timeEstimator + scheduler)
 * with pure math. Runs on both client and server via @starward/core.
 *
 * Input:  TaskStateInput (same shape the coordinator used)
 * Output: RuleEngineResult (superset of GatekeeperResult + TimeEstimatorResult
 *         + SchedulerResult — everything the Sonnet/Haiku handler needs)
 */

import {
  COGNITIVE_BUDGET,
  enforceBudgetSnake,
  computeCognitiveWeight,
} from "./cognitiveBudget.js";

import type {
  TaskStateInput,
  CandidateTask,
  GoalSummary,
  TriagedTask,
  BudgetCheck,
  GoalRotation,
  TimeEstimate,
  ScheduleBlock,
  TierEnforcement,
  CalendarConflict,
} from "../types/taskState.js";

// ── Result type ────────────────────────────────────────────

export interface RuleEngineResult {
  /** Scored, filtered, budget-trimmed tasks ready for the copy handler */
  selectedTasks: TriagedTask[];
  /** Per-task priority scores (0-10) */
  priorityScores: Record<string, number>;
  /** Budget enforcement outcome */
  budgetCheck: BudgetCheck;
  /** Goal rotation metadata */
  goalRotation: GoalRotation;
  /** Duration estimates with planning-fallacy correction */
  timeEstimates: Record<string, TimeEstimate>;
  totalEstimatedMinutes: number;
  exceedsDeepWorkCeiling: boolean;
  /** Schedule structure */
  tierEnforcement: TierEnforcement;
  /** Detected calendar conflicts */
  conflicts: CalendarConflict[];
  /** Recommended task count string for the copy handler */
  recommendedCount: string;
}

// ── Constants ──────────────────────────────────────────────

const STALE_THRESHOLD_DAYS = 3;

/** Planning-fallacy multipliers by category. */
const DURATION_MULTIPLIER: Record<string, number> = {
  coding: 1.5,
  writing: 1.4,
  research: 1.3,
  creative: 1.4,
  study: 1.2,
  review: 1.1,
  admin: 1.1,
  exercise: 1.0,
  planning: 1.3,
};
const DEFAULT_MULTIPLIER = 1.3;

/** Buffer minutes by estimated duration bracket. */
function bufferForDuration(adjustedMinutes: number): number {
  if (adjustedMinutes <= 15) return 5;
  if (adjustedMinutes <= 45) return 10;
  return 15;
}

// ── Scoring ────────────────────────────────────────────────

interface ScoredCandidate {
  task: CandidateTask;
  goal: GoalSummary;
  score: number;
  signal: "high" | "medium" | "low";
  cognitiveWeight: number;
  adjustedDuration: number;
}

/**
 * Score a candidate task on a 0-10 scale using four weighted signals:
 *   - Deadline pressure (0-10) × 0.30
 *   - Recency / staleness (0-10) × 0.25
 *   - Goal importance    (0-10) × 0.25
 *   - Task priority field (0-10) × 0.20
 */
function scoreCandidate(
  task: CandidateTask,
  goal: GoalSummary,
  today: string,
): { score: number; signal: "high" | "medium" | "low" } {
  // 1. Deadline pressure
  let deadlineScore = 5; // neutral default (no deadline)
  if (goal.targetDate) {
    const daysLeft = Math.max(
      0,
      Math.round(
        (new Date(goal.targetDate).getTime() - new Date(today).getTime()) /
          86400000,
      ),
    );
    if (daysLeft <= 3) deadlineScore = 10;
    else if (daysLeft <= 7) deadlineScore = 8;
    else if (daysLeft <= 14) deadlineScore = 7;
    else if (daysLeft <= 30) deadlineScore = 5;
    else deadlineScore = 3;
  }

  // 2. Recency (days since last worked on this goal)
  const daysSince = Math.min(goal.daysSinceLastWorked, 14);
  const recencyScore = Math.round((daysSince / 14) * 10);

  // 3. Goal importance
  const importanceMap: Record<string, number> = {
    critical: 10,
    high: 8,
    medium: 5,
    low: 3,
  };
  const importanceScore =
    importanceMap[(goal as unknown as Record<string, string>).goalImportance ?? "medium"] ?? 5;

  // 4. Task priority field
  const priorityMap: Record<string, number> = {
    "must-do": 9,
    "should-do": 6,
    high: 8,
    medium: 5,
    low: 3,
    bonus: 2,
  };
  const taskPriorityScore = priorityMap[task.priority] ?? 5;

  const score = Math.round(
    (deadlineScore * 0.3 +
      recencyScore * 0.25 +
      importanceScore * 0.25 +
      taskPriorityScore * 0.2) *
      10,
  ) / 10;

  const signal: "high" | "medium" | "low" =
    score >= 7 ? "high" : score >= 4 ? "medium" : "low";

  return { score, signal };
}

// ── Time estimation ────────────────────────────────────────

function estimateDuration(task: CandidateTask): TimeEstimate {
  const multiplier =
    DURATION_MULTIPLIER[task.category?.toLowerCase()] ?? DEFAULT_MULTIPLIER;
  const adjusted = Math.round((task.durationMinutes * multiplier) / 5) * 5;
  const buffer = bufferForDuration(adjusted);

  return {
    originalMinutes: task.durationMinutes,
    adjustedMinutes: adjusted,
    confidence: multiplier <= 1.1 ? "high" : multiplier >= 1.4 ? "low" : "medium",
    bufferMinutes: buffer,
  };
}

// ── Calendar conflict detection ────────────────────────────

function parseTimeToMinutes(time: string): number | null {
  const m = time.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function detectConflicts(
  calendarBlocks: ScheduleBlock[],
  goalBlocks: ScheduleBlock[],
): CalendarConflict[] {
  const conflicts: CalendarConflict[] = [];

  for (const goal of goalBlocks) {
    if (!goal.startTime || !goal.endTime) continue;
    const gStart = parseTimeToMinutes(goal.startTime);
    const gEnd = parseTimeToMinutes(goal.endTime);
    if (gStart == null || gEnd == null) continue;

    for (const cal of calendarBlocks) {
      if (!cal.startTime || !cal.endTime) continue;
      const cStart = parseTimeToMinutes(cal.startTime);
      const cEnd = parseTimeToMinutes(cal.endTime);
      if (cStart == null || cEnd == null) continue;

      const overlapStart = Math.max(gStart, cStart);
      const overlapEnd = Math.min(gEnd, cEnd);
      if (overlapStart < overlapEnd) {
        conflicts.push({
          taskId: goal.goalId ?? goal.label,
          eventTitle: cal.label,
          overlapMinutes: overlapEnd - overlapStart,
          resolution: "move",
        });
      }
    }
  }

  return conflicts;
}

// ── Goal rotation ──────────────────────────────────────────

function computeGoalRotation(input: TaskStateInput): GoalRotation {
  const rotationScores: Record<string, number> = {};
  const staleGoals: string[] = [];

  for (const g of input.goals) {
    if (g.goalType !== "big") continue;
    const recency = Math.min(g.daysSinceLastWorked, 14);
    rotationScores[g.id] = recency / 14;
    if (g.daysSinceLastWorked >= STALE_THRESHOLD_DAYS) {
      staleGoals.push(g.id);
    }
  }

  return {
    goalCount: input.goals.filter((g) => g.goalType === "big").length,
    rotationScores,
    staleGoals,
  };
}

// ── Recommended count ──────────────────────────────────────

function computeRecommendedCount(completionRate: number, maxDailyTasks?: number): string {
  let base: string;
  if (completionRate === -1) {
    base = "3-4 (new user)";
  } else if (completionRate < 40) {
    base = "2 (user is overwhelmed — rebuild confidence)";
  } else if (completionRate < 60) {
    base = "2-3 (user is struggling)";
  } else if (completionRate < 75) {
    base = "3-4 (building momentum)";
  } else if (completionRate < 85) {
    base = "3-5 (healthy zone)";
  } else {
    base = "3-5 + bonus (strong performer)";
  }

  if (maxDailyTasks != null) {
    base = `${Math.max(1, maxDailyTasks - 1)}-${maxDailyTasks} (capacity-adjusted)`;
  }

  return base;
}

// ── Main entry point ───────────────────────────────────────

export function selectDailyTasks(
  input: TaskStateInput,
  opts?: {
    /** Importance field on the goal (not on TaskStateInput by default).
     *  Map of goalId → importance string. */
    goalImportance?: Record<string, string>;
    /** Override max daily tasks (e.g. from monthly context). */
    maxDailyTasks?: number;
  },
): RuleEngineResult {
  const { goalImportance = {}, maxDailyTasks } = opts ?? {};

  // 1. Collect all candidates
  const candidates = input.goals.flatMap((g) => g.planTasksToday);

  // 2. Score every candidate
  const scored: ScoredCandidate[] = candidates.map((task) => {
    const goal = input.goals.find((g) => g.id === task.goalId)!;
    const { score, signal } = scoreCandidate(task, goal, input.date);
    const importance = goalImportance[task.goalId] ?? "medium";
    const weight = computeCognitiveWeight(
      importance,
      task.durationMinutes,
      task.priority,
    );
    const est = estimateDuration(task);

    return {
      task,
      goal,
      score,
      signal,
      cognitiveWeight: weight,
      adjustedDuration: est.adjustedMinutes,
    };
  });

  // 3. Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // 4. Goal-rotation fairness: ensure each active goal gets at least
  //    one task if available, before a second task from the same goal.
  const goalRotation = computeGoalRotation(input);
  const finalOrder: ScoredCandidate[] = [];
  const seenGoals = new Set<string>();
  const remaining: ScoredCandidate[] = [];

  // First pass: one task per goal (highest-scored first)
  for (const s of scored) {
    if (!seenGoals.has(s.task.goalId)) {
      seenGoals.add(s.task.goalId);
      finalOrder.push(s);
    } else {
      remaining.push(s);
    }
  }

  // Second pass: add remaining tasks in score order
  finalOrder.push(...remaining);

  // 5. Convert to TriagedTask + apply budget enforcement
  const triagedTasks: TriagedTask[] = finalOrder.map((s) => ({
    id: s.task.id,
    title: s.task.title,
    description: s.task.description,
    durationMinutes: s.task.durationMinutes,
    goalId: s.task.goalId,
    goalTitle: s.task.goalTitle,
    planNodeId: s.task.planNodeId,
    priority: s.score,
    signal: s.signal,
    cognitiveWeight: s.cognitiveWeight,
    category: s.task.category,
  }));

  const priorityScores: Record<string, number> = {};
  for (const s of finalOrder) {
    priorityScores[s.task.id] = s.score;
  }

  // 6. Budget enforcement
  const taskLimit = maxDailyTasks ?? COGNITIVE_BUDGET.MAX_DAILY_TASKS;
  const snakeTasks = triagedTasks.map((t) => ({
    cognitive_weight: t.cognitiveWeight,
    duration_minutes: t.durationMinutes,
    priority:
      t.signal === "high"
        ? "must-do"
        : t.signal === "medium"
          ? "should-do"
          : "bonus",
    _id: t.id,
  }));

  const trimmed = enforceBudgetSnake(snakeTasks, taskLimit);
  const keptIds = new Set(trimmed.map((t) => (t as typeof snakeTasks[number])._id));
  const droppedIds = triagedTasks
    .filter((t) => !keptIds.has(t.id))
    .map((t) => t.id);

  const selectedTasks = triagedTasks.filter((t) => keptIds.has(t.id));

  const totalWeight = selectedTasks.reduce((s, t) => s + t.cognitiveWeight, 0);

  const budgetCheck: BudgetCheck = {
    totalWeight,
    maxWeight: COGNITIVE_BUDGET.MAX_DAILY_WEIGHT,
    overBudget:
      totalWeight > COGNITIVE_BUDGET.MAX_DAILY_WEIGHT ||
      selectedTasks.length > taskLimit,
    tasksDropped: droppedIds,
  };

  // 7. Time estimates
  const timeEstimates: Record<string, TimeEstimate> = {};
  for (const t of selectedTasks) {
    const candidate = candidates.find((c) => c.id === t.id)!;
    timeEstimates[t.id] = estimateDuration(candidate);
  }

  const totalEstimatedMinutes = Object.values(timeEstimates).reduce(
    (sum, e) => sum + e.adjustedMinutes + e.bufferMinutes,
    0,
  );
  const exceedsDeepWorkCeiling =
    totalEstimatedMinutes > COGNITIVE_BUDGET.MAX_DEEP_MINUTES;

  // 8. Schedule structure
  const calendarBlocks: ScheduleBlock[] = input.scheduledTasks
    .filter((t) => t.scheduledTime)
    .map((t) => ({
      startTime: t.scheduledTime ?? "",
      endTime: t.scheduledEndTime ?? "",
      label: t.title,
      tier: "calendar" as const,
      durationMinutes: t.durationMinutes > 0 ? t.durationMinutes : 60,
    }));

  const goalGroupMap = new Map<
    string,
    { goalId: string; goalTitle: string; totalMinutes: number }
  >();
  for (const t of selectedTasks) {
    if (!t.goalId) continue;
    const est = timeEstimates[t.id];
    const mins = est
      ? est.adjustedMinutes + est.bufferMinutes
      : t.durationMinutes;
    const existing = goalGroupMap.get(t.goalId);
    if (existing) {
      existing.totalMinutes += mins;
    } else {
      goalGroupMap.set(t.goalId, {
        goalId: t.goalId,
        goalTitle: t.goalTitle ?? "Goal",
        totalMinutes: mins,
      });
    }
  }

  const goalBlocks: ScheduleBlock[] = Array.from(goalGroupMap.values()).map(
    (g) => ({
      startTime: "",
      endTime: "",
      label: `Deep work: ${g.goalTitle}`,
      tier: "goal" as const,
      durationMinutes: g.totalMinutes,
      goalId: g.goalId,
    }),
  );

  const taskSlots: ScheduleBlock[] = selectedTasks
    .filter((t) => !t.goalId)
    .map((t) => {
      const est = timeEstimates[t.id];
      const mins = est
        ? est.adjustedMinutes + est.bufferMinutes
        : t.durationMinutes;
      return {
        startTime: "",
        endTime: "",
        label: t.title,
        tier: "task" as const,
        durationMinutes: mins,
      };
    });

  const tierEnforcement: TierEnforcement = {
    calendarBlocks,
    goalBlocks,
    taskSlots,
  };

  const conflicts = detectConflicts(calendarBlocks, goalBlocks);

  // 9. Sequence: momentum task first (lowest weight), then hardest, then
  //    moderate, then satisfying close (medium weight).
  if (selectedTasks.length >= 3) {
    // Find the lightest task → momentum starter
    let lightestIdx = 0;
    for (let i = 1; i < selectedTasks.length; i++) {
      if (selectedTasks[i].cognitiveWeight < selectedTasks[lightestIdx].cognitiveWeight) {
        lightestIdx = i;
      }
    }
    // Move to front
    const [momentum] = selectedTasks.splice(lightestIdx, 1);
    selectedTasks.unshift(momentum);

    // Sort remaining (index 1+) by weight descending (hardest first after momentum)
    const rest = selectedTasks.splice(1);
    rest.sort((a, b) => b.cognitiveWeight - a.cognitiveWeight);
    selectedTasks.push(...rest);
  }

  return {
    selectedTasks,
    priorityScores,
    budgetCheck,
    goalRotation,
    timeEstimates,
    totalEstimatedMinutes,
    exceedsDeepWorkCeiling,
    tierEnforcement,
    conflicts,
    recommendedCount: computeRecommendedCount(
      input.recentCompletionRate,
      maxDailyTasks,
    ),
  };
}
