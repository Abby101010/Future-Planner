/**
 * Goal-related command handlers.
 */

import type { GoalPlan, GoalPlanTask } from "@northstar/core";
import { repos } from "./_helpers";
import { onGoalConfirmed } from "../../coordinators/bigGoalCoordinator";

export async function cmdCreateGoal(
  body: Record<string, unknown>,
): Promise<unknown> {
  const goal = body.goal as Parameters<typeof repos.goals.upsert>[0];
  if (!goal || typeof goal !== "object" || !(goal as { id?: string }).id) {
    throw new Error("command:create-goal requires args.goal with an id");
  }
  await repos.goals.upsert(goal);
  return { ok: true, goalId: goal.id };
}

export async function cmdUpdateGoal(
  body: Record<string, unknown>,
): Promise<unknown> {
  const goal = body.goal as Parameters<typeof repos.goals.upsert>[0];
  if (!goal || typeof goal !== "object" || !(goal as { id?: string }).id) {
    throw new Error("command:update-goal requires args.goal with an id");
  }
  await repos.goals.upsert(goal);
  return { ok: true, goalId: goal.id };
}

export async function cmdDeleteGoal(
  body: Record<string, unknown>,
): Promise<unknown> {
  const goalId = body.goalId as string | undefined;
  if (!goalId) throw new Error("command:delete-goal requires args.goalId");
  await repos.goalPlan.deleteForGoal(goalId);
  await repos.goals.remove(goalId);
  return { ok: true, goalId };
}

export async function cmdConfirmGoalPlan(
  body: Record<string, unknown>,
): Promise<unknown> {
  const goalId = body.goalId as string | undefined;
  if (!goalId) throw new Error("command:confirm-goal-plan requires args.goalId");
  const existing = await repos.goals.get(goalId);
  if (!existing) throw new Error(`goal ${goalId} not found`);
  await repos.goals.upsert({ ...existing, planConfirmed: true });

  // Materialize plan tasks into daily_tasks for the next 14 days.
  // These become pre-committed future tasks the Daily Planner respects.
  const materialized = await materializePlanTasks(goalId, existing.plan);

  // Save Project Agent Context so follow-up conversations have
  // research / personalization data without re-processing from scratch.
  // The chat messages live on goal.planChat (shown in UI);
  // this saves the AI's working memory (research, capacity profile, decisions).
  try {
    const decisions = (existing.planChat ?? [])
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .slice(-5);
    await onGoalConfirmed(goalId, null, null, decisions);
  } catch (err) {
    console.warn("[confirm-goal-plan] save project context failed:", err);
  }

  return { ok: true, goalId, materializedCount: materialized };
}

// ── Plan task materialization ────────────────────────────────

/** Walk the plan hierarchy, resolve day labels to dates, and insert
 *  daily_tasks rows for any task within the next 14 days. */
async function materializePlanTasks(
  goalId: string,
  plan: GoalPlan | null,
): Promise<number> {
  if (!plan || !Array.isArray(plan.years)) return 0;

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 14);
  const horizonStr = horizon.toISOString().split("T")[0];

  // Collect tasks with resolved dates
  const tasksToMaterialize: Array<{
    date: string;
    task: GoalPlanTask;
  }> = [];

  for (const year of plan.years) {
    for (const month of year.months) {
      for (const week of month.weeks) {
        if (week.locked) continue;
        const weekRange = parseWeekRange(week.label, today.getFullYear());
        for (const day of week.days) {
          const resolvedDate = resolveDayDate(day.label, weekRange, today);
          if (!resolvedDate) continue;
          if (resolvedDate < todayStr || resolvedDate > horizonStr) continue;
          for (const task of day.tasks) {
            if (task.completed) continue;
            tasksToMaterialize.push({ date: resolvedDate, task });
          }
        }
      }
    }
  }

  // Check which plan node IDs already have daily_tasks rows
  const existingTasks = await repos.dailyTasks.listForDateRange(todayStr, horizonStr);
  const existingPlanNodeIds = new Set(
    existingTasks.filter((t) => t.planNodeId).map((t) => t.planNodeId),
  );

  let count = 0;
  for (const { date, task } of tasksToMaterialize) {
    if (existingPlanNodeIds.has(task.id)) continue;
    const taskId = `plan-${goalId.slice(0, 8)}-${task.id}`;
    try {
      const existing = await repos.dailyTasks.listForDate(date);
      await repos.dailyTasks.insert({
        id: taskId,
        date,
        goalId,
        planNodeId: task.id,
        title: task.title,
        completed: false,
        orderIndex: existing.length,
        source: "big_goal",
        payload: {
          description: task.description ?? "",
          durationMinutes: task.durationMinutes ?? 30,
          cognitiveWeight: task.priority === "must-do" ? 5 : task.priority === "bonus" ? 1 : 3,
          priority: task.priority ?? "should-do",
          category: task.category ?? "planning",
          source: "plan-materialized",
        },
      });
      count++;
    } catch {
      // Duplicate key — already materialized, safe to skip
    }
  }
  return count;
}

/** Parse a week label like "Jan 6 – Jan 12" into [startISO, endISO]. */
function parseWeekRange(
  weekLabel: string,
  referenceYear: number,
): [string, string] | null {
  const m = weekLabel.match(
    /([A-Za-z]+)\s+(\d{1,2})\s*[–\-]\s*([A-Za-z]+)\s+(\d{1,2})/,
  );
  if (!m) return null;
  const parse = (mon: string, dy: string): string | null => {
    for (const yr of [referenceYear, referenceYear + 1]) {
      const d = new Date(`${mon} ${dy}, ${yr}`);
      if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    }
    return null;
  };
  const start = parse(m[1], m[2]);
  const end = parse(m[3], m[4]);
  return start && end ? [start, end] : null;
}

/** Resolve a day label ("Monday", "Mon", "Jan 6", "2026-04-11") to an
 *  ISO date string, scoped to the parent week range when available. */
function resolveDayDate(
  rawLabel: string,
  weekRange: [string, string] | null,
  referenceDate: Date,
): string | null {
  const label = rawLabel.trim();
  if (!label) return null;

  // ISO date: "2026-04-11"
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return label;

  // Month+day: "Jan 6", "Apr 11"
  const monthDayMatch = label.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (monthDayMatch) {
    const yr = referenceDate.getFullYear();
    for (const y of [yr, yr + 1]) {
      const d = new Date(`${monthDayMatch[1]} ${monthDayMatch[2]}, ${y}`);
      if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
    }
    return null;
  }

  // Weekday name: "Monday", "Mon", etc. — resolve within week range
  if (weekRange) {
    const weekdayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const weekdayShort = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const lower = label.toLowerCase();
    let targetDay = weekdayNames.indexOf(lower);
    if (targetDay === -1) targetDay = weekdayShort.indexOf(lower);
    if (targetDay === -1) {
      // Try prefix match: "tues", "thur", etc.
      targetDay = weekdayNames.findIndex((n) => n.startsWith(lower));
    }
    if (targetDay >= 0) {
      const weekStart = new Date(weekRange[0] + "T12:00:00");
      const startDay = weekStart.getDay();
      const offset = ((targetDay - startDay) % 7 + 7) % 7;
      const resolved = new Date(weekStart);
      resolved.setDate(resolved.getDate() + offset);
      return resolved.toISOString().split("T")[0];
    }
  }

  return null;
}

