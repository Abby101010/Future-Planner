/* NorthStar — goal plan patch applier
 *
 * `applyPlanPatch(plan, patch)` takes an existing GoalPlan and a sparse
 * patch object emitted by the goal-plan-chat LLM and returns a new plan
 * with the patch applied. The patch mirrors the hierarchical plan shape
 * but only needs to include the nodes that actually change; missing ids
 * are left untouched.
 *
 * Invariants:
 *  - Matching is by `id` at every level. Unknown ids are appended (for
 *    days) or ignored (for years/months/weeks) so the model can't
 *    accidentally blow away siblings.
 *  - Task completion state is preserved across replacements. If the
 *    patch includes a task whose id already exists in the plan, the
 *    existing `completed` / `completedAt` fields win.
 *  - The function is pure — it does not mutate `plan` or `patch`.
 */

import type {
  GoalPlan,
  GoalPlanDay,
  GoalPlanMilestone,
  GoalPlanMonth,
  GoalPlanTask,
  GoalPlanWeek,
  GoalPlanYear,
} from "../types/index.js";

type JsonRecord = Record<string, unknown>;

function asRecord(x: unknown): JsonRecord | null {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as JsonRecord) : null;
}

function asArray(x: unknown): unknown[] | null {
  return Array.isArray(x) ? x : null;
}

function mergeTask(
  existing: GoalPlanTask | undefined,
  patch: JsonRecord,
): GoalPlanTask {
  const id = String(patch.id ?? existing?.id ?? "");
  return {
    id,
    title: typeof patch.title === "string" ? patch.title : (existing?.title ?? ""),
    description:
      typeof patch.description === "string"
        ? patch.description
        : (existing?.description ?? ""),
    durationMinutes:
      typeof patch.durationMinutes === "number"
        ? patch.durationMinutes
        : (existing?.durationMinutes ?? 30),
    priority: (typeof patch.priority === "string"
      ? patch.priority
      : (existing?.priority ?? "should-do")) as GoalPlanTask["priority"],
    category: (typeof patch.category === "string"
      ? patch.category
      : (existing?.category ?? "planning")) as GoalPlanTask["category"],
    // Completion state is authoritative from the existing plan. A patch
    // can introduce a new task (existing=undefined), but cannot flip an
    // existing task from completed=true back to false.
    completed: existing?.completed ?? Boolean(patch.completed),
    completedAt: existing?.completedAt,
  };
}

function mergeDay(day: GoalPlanDay, patch: JsonRecord): GoalPlanDay {
  const patchTasks = asArray(patch.tasks);
  const next: GoalPlanDay = {
    ...day,
    label: typeof patch.label === "string" ? patch.label : day.label,
  };
  if (patchTasks) {
    const byId = new Map(day.tasks.map((t) => [t.id, t]));
    next.tasks = patchTasks
      .map((t) => asRecord(t))
      .filter((t): t is JsonRecord => t !== null)
      .map((t) => mergeTask(byId.get(String(t.id ?? "")), t));
  }
  return next;
}

function mergeWeek(week: GoalPlanWeek, patch: JsonRecord): GoalPlanWeek {
  const next: GoalPlanWeek = {
    ...week,
    label: typeof patch.label === "string" ? patch.label : week.label,
    objective:
      typeof patch.objective === "string" ? patch.objective : week.objective,
    locked: typeof patch.locked === "boolean" ? patch.locked : week.locked,
  };
  const patchDays = asArray(patch.days);
  if (!patchDays) return next;

  const originalById = new Map(week.days.map((d) => [d.id, d]));
  const touched = new Set<string>();
  const merged: GoalPlanDay[] = week.days.map((day) => {
    const pd = patchDays
      .map((x) => asRecord(x))
      .find((x): x is JsonRecord => x !== null && String(x.id ?? "") === day.id);
    if (!pd) return day;
    touched.add(day.id);
    return mergeDay(day, pd);
  });

  // Days in the patch that don't correspond to an existing day id are
  // appended. Required fields: id, label, tasks.
  for (const raw of patchDays) {
    const pd = asRecord(raw);
    if (!pd) continue;
    const id = String(pd.id ?? "");
    if (!id || touched.has(id) || originalById.has(id)) continue;
    if (typeof pd.label !== "string") continue;
    const patchTasks = asArray(pd.tasks) ?? [];
    merged.push({
      id,
      label: pd.label,
      tasks: patchTasks
        .map((t) => asRecord(t))
        .filter((t): t is JsonRecord => t !== null)
        .map((t) => mergeTask(undefined, t)),
    });
  }
  next.days = merged;
  return next;
}

function mergeMonth(month: GoalPlanMonth, patch: JsonRecord): GoalPlanMonth {
  const next: GoalPlanMonth = {
    ...month,
    label: typeof patch.label === "string" ? patch.label : month.label,
    objective:
      typeof patch.objective === "string" ? patch.objective : month.objective,
  };
  const patchWeeks = asArray(patch.weeks);
  if (!patchWeeks) return next;
  next.weeks = month.weeks.map((week) => {
    const pw = patchWeeks
      .map((x) => asRecord(x))
      .find((x): x is JsonRecord => x !== null && String(x.id ?? "") === week.id);
    return pw ? mergeWeek(week, pw) : week;
  });
  return next;
}

function mergeYear(year: GoalPlanYear, patch: JsonRecord): GoalPlanYear {
  const next: GoalPlanYear = {
    ...year,
    label: typeof patch.label === "string" ? patch.label : year.label,
    objective:
      typeof patch.objective === "string" ? patch.objective : year.objective,
  };
  const patchMonths = asArray(patch.months);
  if (!patchMonths) return next;
  next.months = year.months.map((month) => {
    const pm = patchMonths
      .map((x) => asRecord(x))
      .find((x): x is JsonRecord => x !== null && String(x.id ?? "") === month.id);
    return pm ? mergeMonth(month, pm) : month;
  });
  return next;
}

export function applyPlanPatch(plan: GoalPlan, patch: unknown): GoalPlan {
  const p = asRecord(patch);
  if (!p) return plan;

  const nextMilestones: GoalPlanMilestone[] = Array.isArray(p.milestones)
    ? (p.milestones as GoalPlanMilestone[])
    : plan.milestones;

  const patchYears = asArray(p.years);
  if (!patchYears) {
    return { ...plan, milestones: nextMilestones };
  }

  const nextYears = plan.years.map((year) => {
    const py = patchYears
      .map((x) => asRecord(x))
      .find((x): x is JsonRecord => x !== null && String(x.id ?? "") === year.id);
    return py ? mergeYear(year, py) : year;
  });

  return { ...plan, milestones: nextMilestones, years: nextYears };
}
