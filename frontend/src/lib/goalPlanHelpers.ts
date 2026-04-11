import type { GoalPlan, GoalPlanTask, GoalPlanMilestone } from "../types";

export function flattenPlanTasks(plan: GoalPlan): GoalPlanTask[] {
  const tasks: GoalPlanTask[] = [];
  for (const yr of plan.years) {
    for (const mo of yr.months) {
      for (const wk of mo.weeks) {
        for (const dy of wk.days) {
          tasks.push(...dy.tasks);
        }
      }
    }
  }
  return tasks;
}

export function countPlanTasks(plan: GoalPlan): {
  total: number;
  completed: number;
} {
  const tasks = flattenPlanTasks(plan);
  return {
    total: tasks.length,
    completed: tasks.filter((t) => t.completed).length,
  };
}

// Distributes tasks evenly across milestones (milestone i owns segment i
// of the total). Each milestone gets a progressPercent [0-100].
export function computeMilestoneProgress(
  plan: GoalPlan,
): Array<
  GoalPlanMilestone & {
    progressPercent: number;
    segmentCompleted: number;
    segmentTotal: number;
  }
> {
  const allTasks = flattenPlanTasks(plan);
  const milestones = plan.milestones;
  if (milestones.length === 0) return [];

  const totalTasks = allTasks.length;
  const perMilestone =
    totalTasks > 0 ? Math.ceil(totalTasks / milestones.length) : 0;

  return milestones.map((ms, i) => {
    const start = i * perMilestone;
    const end = Math.min(start + perMilestone, totalTasks);
    const segment = allTasks.slice(start, end);
    const segmentTotal = segment.length;
    const segmentCompleted = segment.filter((t) => t.completed).length;
    const progressPercent =
      segmentTotal > 0
        ? Math.round((segmentCompleted / segmentTotal) * 100)
        : 0;
    const isFullyDone = segmentTotal > 0 && segmentCompleted === segmentTotal;

    return {
      ...ms,
      completed: ms.completed || isFullyDone,
      progressPercent,
      segmentCompleted,
      segmentTotal,
    };
  });
}

export function syncMilestoneCompletion(plan: GoalPlan): GoalPlan {
  const progress = computeMilestoneProgress(plan);
  const updatedMilestones = plan.milestones.map((ms, i) => ({
    ...ms,
    completed: progress[i]?.completed ?? ms.completed,
    totalTasks: progress[i]?.segmentTotal ?? 0,
    completedTasks: progress[i]?.segmentCompleted ?? 0,
  }));
  return { ...plan, milestones: updatedMilestones };
}

export function toggleTaskInPlan(
  plan: GoalPlan,
  weekId: string,
  dayId: string,
  taskId: string,
): GoalPlan {
  return {
    ...plan,
    years: plan.years.map((yr) => ({
      ...yr,
      months: yr.months.map((mo) => ({
        ...mo,
        weeks: mo.weeks.map((wk) => {
          if (wk.id !== weekId) return wk;
          return {
            ...wk,
            days: wk.days.map((dy) => {
              if (dy.id !== dayId) return dy;
              return {
                ...dy,
                tasks: dy.tasks.map((t) =>
                  t.id === taskId
                    ? {
                        ...t,
                        completed: !t.completed,
                        completedAt: !t.completed
                          ? new Date().toISOString()
                          : undefined,
                      }
                    : t,
                ),
              };
            }),
          };
        }),
      })),
    })),
  };
}

export function unlockNextWeek(plan: GoalPlan): GoalPlan {
  let unlocked = false;
  return {
    ...plan,
    years: plan.years.map((yr) => ({
      ...yr,
      months: yr.months.map((mo) => ({
        ...mo,
        weeks: mo.weeks.map((wk) => {
          if (!unlocked && wk.locked) {
            unlocked = true;
            return { ...wk, locked: false };
          }
          return wk;
        }),
      })),
    })),
  };
}

// CRITICAL: preserves completed task state. The LLM doesn't know which
// tasks the user has already checked off. Whenever a task in the patch has
// the same id as an existing task, we carry forward `completed` and
// `completedAt` from the old plan. If the patch omits a completed task, we
// preserve it (the LLM clearly didn't intend to delete user progress).
function mergeTaskList(
  oldTasks: GoalPlan["years"][number]["months"][number]["weeks"][number]["days"][number]["tasks"],
  patchTasks: Array<Record<string, unknown>>,
): typeof oldTasks {
  const oldById = new Map(oldTasks.map((t) => [t.id, t]));
  const patchedIds = new Set<string>();

  const merged = patchTasks.map((pt) => {
    const id = pt.id as string;
    patchedIds.add(id);
    const old = oldById.get(id);
    if (old) {
      return {
        ...old,
        ...pt,
        completed: old.completed,
        completedAt: old.completedAt,
      } as (typeof oldTasks)[number];
    }
    return {
      completed: false,
      ...pt,
    } as unknown as (typeof oldTasks)[number];
  });

  for (const old of oldTasks) {
    if (!patchedIds.has(old.id) && old.completed) {
      merged.push(old);
    }
  }
  return merged;
}

function mergeDayList(
  oldDays: GoalPlan["years"][number]["months"][number]["weeks"][number]["days"],
  patchDays: Array<Record<string, unknown>>,
): typeof oldDays {
  const oldById = new Map(oldDays.map((d) => [d.id, d]));
  const patchedIds = new Set<string>();

  const merged = patchDays.map((pd) => {
    const id = pd.id as string;
    patchedIds.add(id);
    const old = oldById.get(id);
    const patchTasks = (pd.tasks as Array<Record<string, unknown>>) || null;
    if (old) {
      return {
        ...old,
        ...(pd.label ? { label: pd.label as string } : {}),
        tasks: patchTasks ? mergeTaskList(old.tasks, patchTasks) : old.tasks,
      } as (typeof oldDays)[number];
    }
    return {
      tasks: [],
      ...pd,
    } as unknown as (typeof oldDays)[number];
  });

  for (const old of oldDays) {
    if (!patchedIds.has(old.id)) merged.push(old);
  }
  return merged;
}

// When the LLM returns a full replacement plan (planReady: true), walk the
// new plan and copy `completed` / `completedAt` from the old plan when task
// ids (or titles, as a fallback for regenerated ids) match.
export function mergePlanPreservingProgress(
  oldPlan: GoalPlan | null,
  newPlan: GoalPlan,
): GoalPlan {
  if (!oldPlan) return newPlan;

  const oldTaskById = new Map<
    string,
    { completed: boolean; completedAt?: string }
  >();
  const oldTaskByTitle = new Map<
    string,
    { completed: boolean; completedAt?: string }
  >();
  const oldMilestoneById = new Map<string, boolean>();

  for (const ms of oldPlan.milestones || []) {
    if (ms.completed) oldMilestoneById.set(ms.id, true);
  }
  for (const yr of oldPlan.years || []) {
    for (const mo of yr.months || []) {
      for (const wk of mo.weeks || []) {
        for (const dy of wk.days || []) {
          for (const t of dy.tasks || []) {
            if (t.completed) {
              const entry = { completed: true, completedAt: t.completedAt };
              oldTaskById.set(t.id, entry);
              oldTaskByTitle.set(t.title.trim().toLowerCase(), entry);
            }
          }
        }
      }
    }
  }

  return {
    ...newPlan,
    milestones: (newPlan.milestones || []).map((ms) =>
      oldMilestoneById.has(ms.id) ? { ...ms, completed: true } : ms,
    ),
    years: (newPlan.years || []).map((yr) => ({
      ...yr,
      months: (yr.months || []).map((mo) => ({
        ...mo,
        weeks: (mo.weeks || []).map((wk) => ({
          ...wk,
          days: (wk.days || []).map((dy) => ({
            ...dy,
            tasks: (dy.tasks || []).map((t) => {
              const prior =
                oldTaskById.get(t.id) ||
                oldTaskByTitle.get(t.title.trim().toLowerCase());
              return prior
                ? { ...t, completed: true, completedAt: prior.completedAt }
                : t;
            }),
          })),
        })),
      })),
    })),
  };
}

export function applyPlanPatch(
  plan: GoalPlan,
  patch: Record<string, unknown>,
): GoalPlan {
  const patchYears = patch.years as Array<Record<string, unknown>> | null;
  const patchMilestones = patch.milestones as Array<
    Record<string, unknown>
  > | null;

  let updated = { ...plan };

  if (patchMilestones) {
    updated = {
      ...updated,
      milestones: updated.milestones.map((ms) => {
        const p = patchMilestones.find((pm) => pm.id === ms.id);
        if (!p) return ms;
        return { ...ms, ...p, completed: ms.completed } as typeof ms;
      }),
    };
  }

  if (patchYears) {
    updated = {
      ...updated,
      years: updated.years.map((yr) => {
        const pYr = patchYears.find((py) => py.id === yr.id) as
          | Record<string, unknown>
          | undefined;
        if (!pYr) return yr;

        const patchMonths = (pYr.months || []) as Array<
          Record<string, unknown>
        >;
        return {
          ...yr,
          ...(pYr.objective ? { objective: pYr.objective as string } : {}),
          ...(pYr.label ? { label: pYr.label as string } : {}),
          months: yr.months.map((mo) => {
            const pMo = patchMonths.find((pm) => pm.id === mo.id) as
              | Record<string, unknown>
              | undefined;
            if (!pMo) return mo;

            const patchWeeks = (pMo.weeks || []) as Array<
              Record<string, unknown>
            >;
            return {
              ...mo,
              ...(pMo.objective ? { objective: pMo.objective as string } : {}),
              ...(pMo.label ? { label: pMo.label as string } : {}),
              weeks: mo.weeks.map((wk) => {
                const pWk = patchWeeks.find((pw) => pw.id === wk.id) as
                  | Record<string, unknown>
                  | undefined;
                if (!pWk) return wk;
                const patchDays = pWk.days as
                  | Array<Record<string, unknown>>
                  | undefined;
                return {
                  ...wk,
                  ...(pWk.objective
                    ? { objective: pWk.objective as string }
                    : {}),
                  ...(pWk.label ? { label: pWk.label as string } : {}),
                  ...(typeof pWk.locked === "boolean"
                    ? { locked: pWk.locked as boolean }
                    : {}),
                  days: patchDays ? mergeDayList(wk.days, patchDays) : wk.days,
                } as typeof wk;
              }),
            };
          }),
        };
      }),
    };
  }

  return updated;
}
