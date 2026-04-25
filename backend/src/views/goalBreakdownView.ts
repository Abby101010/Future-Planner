/* Starward server — goal breakdown view resolver
 *
 * When a goalId is provided, returns scheduled tasks filtered to that goal
 * AND a full GoalBreakdown tree reconstructed from the goal_plan_nodes rows.
 * When no goalId is provided, returns a global 90-day scheduled-tasks view
 * (legacy behaviour for the old cross-goal page).
 *
 * ⚠ Canonical consumer: frontend/src/pages/goals/BreakdownTab.tsx
 *   - Year row reads  `y.label ?? y.id`            (BreakdownTab.tsx:226)
 *   - Week row reads  `w.label ?? w.id`            (:284)
 *   - Task row reads  `t.estimatedDurationMinutes
 *                       ?? t.duration ?? "?"`      (:339)
 *   - Task row keys on `t.id`                      (:299)
 * Emission here MUST populate those fields. Renames or additions that
 * change the shape must be updated in BreakdownTab at the same time.
 */

import * as repos from "../repositories";
import type {
  BreakdownTask,
  DailyTask,
  DayPlan,
  Goal,
  GoalBreakdown,
  GoalPlan,
  GoalPlanTask,
  GoalPlanWeek,
  MonthPlan,
  WeekPlan,
  YearPlan,
} from "@starward/core";
import { flattenDailyTask } from "./_mappers";

export interface GoalBreakdownViewArgs {
  goalId?: string;
}

export interface GoalBreakdownView {
  goalBreakdown: GoalBreakdown | null;
  scheduledTasks: DailyTask[];
}

// ── GoalPlan → GoalBreakdown mapper ────────────────────────────

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function toBreakdownCategory(
  c: GoalPlanTask["category"] | undefined,
): BreakdownTask["category"] {
  switch (c) {
    case "learning":
    case "building":
    case "networking":
    case "reflection":
    case "planning":
      return c;
    default:
      return "planning";
  }
}

function toBreakdownPriority(
  p: GoalPlanTask["priority"] | undefined,
): BreakdownTask["priority"] {
  switch (p) {
    case "must-do":
    case "should-do":
    case "bonus":
      return p;
    default:
      return "should-do";
  }
}

/** Map a GoalPlanTask to a BreakdownTask. Fills in conservative defaults
 *  for fields GoalPlan doesn't carry (whyToday). Emits `id` and
 *  `estimatedDurationMinutes` for BreakdownTab.tsx — see file banner. */
function toBreakdownTask(t: GoalPlanTask): BreakdownTask {
  const minutes = t.durationMinutes ?? 30;
  return {
    title: t.title,
    description: t.description ?? "",
    durationMinutes: minutes,
    category: toBreakdownCategory(t.category),
    whyToday: "",
    priority: toBreakdownPriority(t.priority),
    id: t.id,
    estimatedDurationMinutes: minutes,
  };
}

/** Parse an ISO date (YYYY-MM-DD) safely; returns null if invalid. */
function parseIso(date: string | null | undefined): Date | null {
  if (!date) return null;
  const d = new Date(date + "T12:00:00");
  return isNaN(d.getTime()) ? null : d;
}

function dayMeta(date: string): {
  dayName: string;
  isWeekend: boolean;
} {
  const d = parseIso(date);
  if (!d) return { dayName: "", isWeekend: false };
  const weekday = d.getDay(); // 0 Sun .. 6 Sat
  return {
    dayName: DAY_NAMES[weekday],
    isWeekend: weekday === 0 || weekday === 6,
  };
}

function sumTaskMinutes(tasks: GoalPlanTask[]): number {
  return tasks.reduce((sum, t) => sum + (t.durationMinutes ?? 0), 0);
}

function intensityForWeek(totalMinutes: number): WeekPlan["intensity"] {
  if (totalMinutes < 300) return "light";       // <5h/wk
  if (totalMinutes < 900) return "normal";      // 5–15h/wk
  return "heavy";                                // 15h+/wk
}

function mapWeek(week: GoalPlanWeek): WeekPlan {
  const days: DayPlan[] = (week.days ?? []).map((dy) => {
    // Prefer a real ISO date; fall back to day label.
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dy.label) ? dy.label : "";
    const { dayName, isWeekend } = dayMeta(date);
    const tasks = (dy.tasks ?? []).map(toBreakdownTask);
    return {
      date,
      dayName,
      availableMinutes: 480,
      isVacation: false,
      isWeekend,
      tasks,
      id: dy.id,
    };
  });

  const flatTasks = (week.days ?? []).flatMap((d) => d.tasks ?? []);
  const totalMinutes = sumTaskMinutes(flatTasks);

  return {
    weekNumber: 0, // filled in by the caller
    startDate: days.find((d) => d.date)?.date ?? "",
    endDate: [...days].reverse().find((d) => d.date)?.date ?? "",
    focus: week.objective ?? week.label ?? "",
    deliverables: [],
    estimatedHours: Math.round((totalMinutes / 60) * 10) / 10,
    intensity: intensityForWeek(totalMinutes),
    days,
    id: week.id,
    label: week.label ?? "",
    locked: Boolean(week.locked),
  };
}

function mapMonth(plan: GoalPlan, monthIdx: number, yearIdx: number): MonthPlan {
  const monthNode = plan.years[yearIdx].months[monthIdx];
  const weeks: WeekPlan[] = (monthNode.weeks ?? []).map((w, i) => {
    const mapped = mapWeek(w);
    mapped.weekNumber = i + 1;
    return mapped;
  });
  const estimatedHours = weeks.reduce((s, w) => s + w.estimatedHours, 0);
  return {
    month: monthNode.label ?? "",
    label: monthNode.label ?? "",
    focus: monthNode.objective ?? "",
    objectives: monthNode.objective ? [monthNode.objective] : [],
    reasoning: "",
    adjustedFor: null,
    estimatedHours: Math.round(estimatedHours * 10) / 10,
    weeks,
  };
}

function mapYear(plan: GoalPlan, yearIdx: number): YearPlan {
  const yearNode = plan.years[yearIdx];
  // Best-effort year number: parse leading 4-digit year out of the label.
  const match = /\b(20\d{2})\b/.exec(yearNode.label ?? "");
  const year = match ? parseInt(match[1], 10) : new Date().getFullYear() + yearIdx;
  const months = (yearNode.months ?? []).map((_, i) => mapMonth(plan, i, yearIdx));
  return {
    year,
    theme: yearNode.objective ?? yearNode.label ?? "",
    outcome: yearNode.objective ?? "",
    months,
    id: yearNode.id,
    label: yearNode.label ?? "",
  };
}

/** Build a GoalBreakdown from a reconstructed GoalPlan + the owning Goal.
 *  Missing/derivable fields (totalEstimatedHours, confidenceLevel, etc.)
 *  are computed from the plan itself. */
function planToBreakdown(goal: Goal, plan: GoalPlan): GoalBreakdown {
  const yearlyBreakdown: YearPlan[] = (plan.years ?? []).map((_, i) => mapYear(plan, i));
  const totalEstimatedHours = yearlyBreakdown.reduce(
    (s, y) => s + y.months.reduce((m, mo) => m + mo.estimatedHours, 0),
    0,
  );
  return {
    id: goal.id,
    goalSummary: goal.goalDescription || goal.description || goal.title,
    totalEstimatedHours: Math.round(totalEstimatedHours * 10) / 10,
    projectedCompletion: goal.targetDate ?? "",
    confidenceLevel: "medium",
    reasoning:
      "Derived from goal_plan_nodes via reconstructPlan + planToBreakdown mapper.",
    yearlyBreakdown,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
    version: 1,
  };
}

// ── Resolver ───────────────────────────────────────────────────

export async function resolveGoalBreakdownView(
  args?: GoalBreakdownViewArgs,
): Promise<GoalBreakdownView> {
  const { goalId } = args ?? {};

  const today = new Date().toISOString().split("T")[0];
  const end = new Date();
  end.setDate(end.getDate() + 90);
  const endISO = end.toISOString().split("T")[0];

  const taskRecords = await repos.dailyTasks.listForDateRange(today, endISO);
  // Build goalId→title map so scheduledTasks carry goalTitle for the
  // "from <goal>" subtext on TaskRow / Calendar side view. Cross-goal
  // here because scheduledTasks aren't necessarily scoped to one goal
  // when goalId is omitted (the legacy cross-goal path).
  const allGoalsForTitles = await repos.goals.list();
  const goalsById = new Map<string, string>(
    allGoalsForTitles.map((g) => [g.id, g.title]),
  );
  const scheduledTasks = taskRecords
    .filter((r) => (r.payload as Record<string, unknown>).scheduledTime)
    .filter((r) => !goalId || r.goalId === goalId)
    .map((r) => flattenDailyTask(r, r.date, goalsById));

  let goalBreakdown: GoalBreakdown | null = null;
  if (goalId) {
    const goal = await repos.goals.get(goalId);
    if (goal) {
      const nodes = await repos.goalPlan.listForGoal(goalId);
      if (nodes.length > 0) {
        const plan = repos.goalPlan.reconstructPlan(nodes);
        if (plan && (plan.years.length > 0 || plan.milestones.length > 0)) {
          goalBreakdown = planToBreakdown(goal, plan);
        }
      }
      if (!goalBreakdown && goal.plan) {
        goalBreakdown = planToBreakdown(goal, goal.plan);
      }
    }
  }

  return {
    goalBreakdown,
    scheduledTasks,
  };
}
