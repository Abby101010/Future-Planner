/* ──────────────────────────────────────────────────────────
   NorthStar — Cognitive Budget Domain Rules

   Pure, framework-free business rules. No React, no IPC,
   no localStorage. Imported by:
     - src/store/useStore.ts (confirmPendingTask)
     - electron/ai-handler.ts (handleDailyTasks post-processing)
   so the renderer and the AI pipeline always agree on the
   same cognitive-load policy.
   ────────────────────────────────────────────────────────── */

/** Hard ceilings derived from decision-fatigue + deep-work research. */
export const COGNITIVE_BUDGET = {
  /** Max total cognitive weight per day (sum of task weights). */
  MAX_DAILY_WEIGHT: 12,
  /** Max number of must-do/should-do tasks per day before decision fatigue. */
  MAX_DAILY_TASKS: 5,
  /** Max minutes of deep-work tasks per day (3-hour ceiling). */
  MAX_DEEP_MINUTES: 180,
  /** Default cognitive weight when a task doesn't specify one. */
  DEFAULT_WEIGHT: 3,
  /** Default duration when a task doesn't specify one. */
  DEFAULT_DURATION: 30,
  /** Grace allowance for the bonus task on top of MAX_DAILY_WEIGHT. */
  BONUS_GRACE: 2,
} as const;

export type TaskPriority = "must-do" | "should-do" | "bonus";

/** Maps goal importance → default task priority + cognitive weight base + frequency. */
export const IMPORTANCE_PRIORITY_RULES = {
  critical: { defaultPriority: "must-do" as TaskPriority, baseWeight: 4, freqLabel: "daily" },
  high:     { defaultPriority: "must-do" as TaskPriority, baseWeight: 3, freqLabel: "5-6x/week" },
  medium:   { defaultPriority: "should-do" as TaskPriority, baseWeight: 3, freqLabel: "3-4x/week" },
  low:      { defaultPriority: "should-do" as TaskPriority, baseWeight: 2, freqLabel: "1-2x/week" },
} as const;

/**
 * Compute cognitive weight from goal importance + task duration + task priority.
 * Replaces the hardcoded `weight = 3` in scenarios.ts.
 */
export function computeCognitiveWeight(
  goalImportance: string,
  durationMinutes: number,
  taskPriority: string,
): number {
  const rules = IMPORTANCE_PRIORITY_RULES[goalImportance as keyof typeof IMPORTANCE_PRIORITY_RULES]
    ?? IMPORTANCE_PRIORITY_RULES.medium;
  const base = rules.baseWeight;
  const durationMod = durationMinutes >= 60 ? 1 : durationMinutes <= 15 ? -1 : 0;
  const priorityMod = taskPriority === "must-do" ? 1 : taskPriority === "bonus" ? -1 : 0;
  return Math.max(1, Math.min(5, base + durationMod + priorityMod));
}

interface BudgetableTask {
  cognitiveWeight?: number;
  durationMinutes?: number;
  priority?: TaskPriority | string;
}

interface BudgetableSnakeTask {
  cognitive_weight?: number;
  duration_minutes?: number;
  priority?: TaskPriority | string;
}

/** Ordering used when trimming over-budget task lists. */
const PRIORITY_ORDER: Record<string, number> = {
  "must-do": 0,
  "should-do": 1,
  "bonus": 2,
};

/**
 * Sum the cognitive weight of a task array, defaulting missing weights.
 */
export function totalWeight(tasks: BudgetableTask[]): number {
  return tasks.reduce(
    (sum, t) => sum + (t.cognitiveWeight ?? COGNITIVE_BUDGET.DEFAULT_WEIGHT),
    0,
  );
}

/**
 * Sum the duration of a task array, defaulting missing durations.
 */
export function totalMinutes(tasks: BudgetableTask[]): number {
  return tasks.reduce(
    (sum, t) => sum + (t.durationMinutes ?? COGNITIVE_BUDGET.DEFAULT_DURATION),
    0,
  );
}

/**
 * Count tasks that occupy a daily-task slot (must-do + should-do).
 * Bonus tasks don't consume a daily-task slot.
 */
export function countDailyTaskSlots(tasks: BudgetableTask[]): number {
  return tasks.filter(
    (t) => t.priority === "must-do" || t.priority === "should-do",
  ).length;
}

/**
 * Decide whether a new task can keep its requested priority or must be
 * downgraded to "bonus" because adding it would blow one of the daily ceilings.
 *
 * Used by the renderer when the user confirms a quick-add task.
 */
export function downgradeIfOverBudget(
  existing: BudgetableTask[],
  newTask: BudgetableTask,
  requestedPriority: TaskPriority,
): TaskPriority {
  const currentWeight = totalWeight(existing);
  const currentMinutes = totalMinutes(existing);
  const slotCount = countDailyTaskSlots(existing);

  const taskWeight = newTask.cognitiveWeight ?? COGNITIVE_BUDGET.DEFAULT_WEIGHT;
  const taskMinutes = newTask.durationMinutes ?? COGNITIVE_BUDGET.DEFAULT_DURATION;

  const wouldExceedWeight = currentWeight + taskWeight > COGNITIVE_BUDGET.MAX_DAILY_WEIGHT;
  const wouldExceedSlots = slotCount >= COGNITIVE_BUDGET.MAX_DAILY_TASKS;
  const wouldExceedTime = currentMinutes + taskMinutes > COGNITIVE_BUDGET.MAX_DEEP_MINUTES;

  if (wouldExceedWeight || wouldExceedSlots || wouldExceedTime) {
    return "bonus";
  }
  return requestedPriority;
}

/**
 * Trim an AI-returned task list (snake_case shape) so it respects the
 * task-count and total-weight ceilings. Mutates and returns the array.
 *
 * Used in the daily-task AI handler as a post-processing guardrail —
 * even if the LLM ignores its instructions, the user never sees more
 * tasks than the budget allows.
 */
export function enforceBudgetSnake(
  tasks: BudgetableSnakeTask[],
  hardLimit: number = COGNITIVE_BUDGET.MAX_DAILY_TASKS,
  weightBudget: number = COGNITIVE_BUDGET.MAX_DAILY_WEIGHT,
): BudgetableSnakeTask[] {
  let result = [...tasks];

  // Sort by priority ascending, then by cognitive weight descending (high-impact first)
  result.sort((a, b) => {
    const pa = PRIORITY_ORDER[(a.priority as string) || "should-do"] ?? 1;
    const pb = PRIORITY_ORDER[(b.priority as string) || "should-do"] ?? 1;
    if (pa !== pb) return pa - pb;
    return (
      (b.cognitive_weight ?? COGNITIVE_BUDGET.DEFAULT_WEIGHT) -
      (a.cognitive_weight ?? COGNITIVE_BUDGET.DEFAULT_WEIGHT)
    );
  });

  if (result.length > hardLimit) {
    result = result.slice(0, hardLimit);
  }

  // Drop lowest-priority tasks until total weight fits the budget,
  // but never go below 2 tasks.
  let weight = result.reduce(
    (s, t) => s + (t.cognitive_weight ?? COGNITIVE_BUDGET.DEFAULT_WEIGHT),
    0,
  );
  while (weight > weightBudget && result.length > 2) {
    const removed = result.pop()!;
    weight -= removed.cognitive_weight ?? COGNITIVE_BUDGET.DEFAULT_WEIGHT;
  }

  return result;
}

/**
 * Decide whether a bonus task fits within the bonus grace allowance.
 */
export function bonusTaskFits(
  currentWeight: number,
  bonusWeight: number,
  weightBudget: number = COGNITIVE_BUDGET.MAX_DAILY_WEIGHT,
): boolean {
  return currentWeight + bonusWeight <= weightBudget + COGNITIVE_BUDGET.BONUS_GRACE;
}
