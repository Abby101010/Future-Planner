/* NorthStar server — goal plan nodes repository
 *
 * Wraps `goal_plan_nodes` (migration 0002), which stores the hierarchical
 * GoalPlan { milestones, years[ months[ weeks[ days[ tasks[] ] ] ] ] } as a
 * single recursive table keyed by (user_id, id) with parent_id pointing at
 * the containing node.
 *
 * This module ships a pure helper `reconstructPlan` that folds a flat list
 * of rows back into the nested @northstar/core GoalPlan shape — view
 * resolvers (Task 12) will call it.
 *
 * All queries are user_id-scoped via getCurrentUserId() and parameterized.
 */

import { randomUUID } from "node:crypto";
import type {
  GoalPlan,
  GoalPlanMilestone,
  GoalPlanYear,
  GoalPlanMonth,
  GoalPlanWeek,
  GoalPlanDay,
  GoalPlanTask,
} from "@northstar/core";
import { query } from "../db/pool";
import { requireUserId } from "./_context";
import { parseJson } from "./_json";

/** Generate a short random hex ID with a prefix (e.g. "week-a3f7c912"). */
function genId(prefix: string): string {
  return `${prefix}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export type GoalPlanNodeType =
  | "milestone"
  | "year"
  | "month"
  | "week"
  | "day"
  | "task";

export interface GoalPlanNode {
  id: string;
  goalId: string;
  parentId: string | null;
  nodeType: GoalPlanNodeType;
  title: string;
  description: string;
  startDate: string | null;
  endDate: string | null;
  orderIndex: number;
  /** Level-specific fields that didn't earn a typed column (objective, locked,
   *  priority, category, completed, completedAt, durationMinutes, etc.) */
  payload: Record<string, unknown>;
}

interface GoalPlanNodeRow {
  id: string;
  user_id: string;
  goal_id: string;
  parent_id: string | null;
  node_type: string;
  title: string;
  description: string;
  start_date: string | null;
  end_date: string | null;
  order_index: number;
  payload: Record<string, unknown> | string | null;
  created_at: string;
  updated_at: string;
}

function rowToNode(r: GoalPlanNodeRow): GoalPlanNode {
  return {
    id: r.id,
    goalId: r.goal_id,
    parentId: r.parent_id,
    nodeType: r.node_type as GoalPlanNodeType,
    title: r.title,
    description: r.description,
    startDate: r.start_date,
    endDate: r.end_date,
    orderIndex: r.order_index,
    payload: parseJson(r.payload),
  };
}

export async function listForGoal(goalId: string): Promise<GoalPlanNode[]> {
  const userId = requireUserId();
  const rows = await query<GoalPlanNodeRow>(
    `select * from goal_plan_nodes
      where user_id = $1 and goal_id = $2
      order by order_index asc, id asc`,
    [userId, goalId],
  );
  return rows.map(rowToNode);
}

export async function getNode(id: string): Promise<GoalPlanNode | null> {
  const userId = requireUserId();
  const rows = await query<GoalPlanNodeRow>(
    `select * from goal_plan_nodes where user_id = $1 and id = $2`,
    [userId, id],
  );
  return rows.length > 0 ? rowToNode(rows[0]) : null;
}

/** Merge `patch` into the existing `payload` JSONB of a single node.
 *  Used by toggle-task to sync completion state from daily_tasks back
 *  into the goal plan tree without rewriting every node. */
export async function patchNodePayload(
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const userId = requireUserId();
  await query(
    `update goal_plan_nodes
        set payload = payload || $3::jsonb,
            updated_at = now()
      where user_id = $1 and id = $2`,
    [userId, id, JSON.stringify(patch)],
  );
}

/** Bulk upsert a set of nodes for a single goal. Callers are responsible for
 *  computing parent/child relationships — this function does not mutate the
 *  shape, it just persists it row-by-row in one implicit batch. */
export async function upsertNodes(
  goalId: string,
  nodes: GoalPlanNode[],
): Promise<void> {
  const userId = requireUserId();
  for (const n of nodes) {
    await query(
      `insert into goal_plan_nodes (
         id, user_id, goal_id, parent_id, node_type, title, description,
         start_date, end_date, order_index, payload, updated_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, now()
       )
       on conflict (user_id, id) do update set
         goal_id = excluded.goal_id,
         parent_id = excluded.parent_id,
         node_type = excluded.node_type,
         title = excluded.title,
         description = excluded.description,
         start_date = excluded.start_date,
         end_date = excluded.end_date,
         order_index = excluded.order_index,
         payload = excluded.payload,
         updated_at = now()`,
      [
        n.id,
        userId,
        goalId,
        n.parentId,
        n.nodeType,
        n.title,
        n.description,
        n.startDate,
        n.endDate,
        n.orderIndex,
        JSON.stringify(n.payload ?? {}),
      ],
    );
  }
}

export async function deleteForGoal(goalId: string): Promise<void> {
  const userId = requireUserId();
  await query(
    `delete from goal_plan_nodes where user_id = $1 and goal_id = $2`,
    [userId, goalId],
  );
}

// ── Pure helper: hierarchical GoalPlan → flat rows ──────────────

/** Walk a nested GoalPlan and produce the flat list of nodes the
 *  `goal_plan_nodes` table expects. Parent/child links via parentId,
 *  order preserved via orderIndex. Level-specific fields that don't
 *  have typed columns (objective, locked, priority, category, …) land
 *  in `payload` JSONB. Pure function — no DB access. */
export function flattenPlan(goalId: string, plan: GoalPlan): GoalPlanNode[] {
  const out: GoalPlanNode[] = [];
  const milestones = Array.isArray(plan.milestones) ? plan.milestones : [];
  const years = Array.isArray(plan.years) ? plan.years : [];

  milestones.forEach((m, i) => {
    out.push({
      id: m.id,
      goalId,
      parentId: null,
      nodeType: "milestone",
      title: m.title ?? "",
      description: m.description ?? "",
      startDate: null,
      endDate: m.targetDate ?? null,
      orderIndex: i,
      payload: {
        targetDate: m.targetDate ?? "",
        completed: Boolean(m.completed),
        totalTasks: m.totalTasks,
        completedTasks: m.completedTasks,
      },
    });
  });

  years.forEach((y, yi) => {
    out.push({
      id: y.id,
      goalId,
      parentId: null,
      nodeType: "year",
      title: y.label ?? "",
      description: "",
      startDate: null,
      endDate: null,
      orderIndex: yi,
      payload: { label: y.label ?? "", objective: y.objective ?? "" },
    });
    const months = Array.isArray(y.months) ? y.months : [];
    months.forEach((mo, moi) => {
      out.push({
        id: mo.id,
        goalId,
        parentId: y.id,
        nodeType: "month",
        title: mo.label ?? "",
        description: "",
        startDate: null,
        endDate: null,
        orderIndex: moi,
        payload: { label: mo.label ?? "", objective: mo.objective ?? "" },
      });
      const weeks = Array.isArray(mo.weeks) ? mo.weeks : [];
      weeks.forEach((w, wi) => {
        const days = Array.isArray(w.days) ? w.days : [];
        // Derive week start/end from day labels (guaranteed ISO after normalization)
        let weekStart: string | null = null;
        let weekEnd: string | null = null;
        for (const d of days) {
          if (isISODate(d.label)) {
            if (!weekStart || d.label < weekStart) weekStart = d.label;
            if (!weekEnd || d.label > weekEnd) weekEnd = d.label;
          }
        }
        out.push({
          id: w.id,
          goalId,
          parentId: mo.id,
          nodeType: "week",
          title: w.label ?? "",
          description: "",
          startDate: weekStart,
          endDate: weekEnd,
          orderIndex: wi,
          payload: {
            label: w.label ?? "",
            objective: w.objective ?? "",
            locked: Boolean(w.locked),
          },
        });
        days.forEach((d, di) => {
          const dayDate = isISODate(d.label) ? d.label : null;
          out.push({
            id: d.id,
            goalId,
            parentId: w.id,
            nodeType: "day",
            title: d.label ?? "",
            description: "",
            startDate: dayDate,
            endDate: dayDate,
            orderIndex: di,
            payload: { label: d.label ?? "" },
          });
          const tasks = Array.isArray(d.tasks) ? d.tasks : [];
          tasks.forEach((t, ti) => {
            out.push({
              id: t.id,
              goalId,
              parentId: d.id,
              nodeType: "task",
              title: t.title ?? "",
              description: t.description ?? "",
              startDate: null,
              endDate: null,
              orderIndex: ti,
              payload: {
                durationMinutes: t.durationMinutes ?? 0,
                priority: t.priority ?? "should-do",
                category: t.category ?? "planning",
                completed: Boolean(t.completed),
                completedAt: t.completedAt,
              },
            });
          });
        });
      });
    });
  });

  return out;
}

// ── Date label helpers ──

const SHORT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const FULL_MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function isISODate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function isGenericWeekLabel(s: string): boolean {
  return !s || !s.trim() || /^week\s+\d+$/i.test(s.trim());
}
function isGenericMonthLabel(s: string): boolean {
  return !s || !s.trim() || /^month\s+\d+$/i.test(s.trim());
}
function isGenericYearLabel(s: string): boolean {
  return !s || !s.trim() || /^year\s+\d+$/i.test(s.trim());
}
function isGenericDayLabel(s: string): boolean {
  return !s || !s.trim() ||
    /^day\s+\d+$/i.test(s.trim()) ||
    /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)$/i.test(s.trim());
}

/** Format a Date as "Apr 14". */
function fmtShort(d: Date): string {
  return `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Get the next Monday on or after a date. */
function nextMonday(d: Date): Date {
  const result = new Date(d);
  result.setHours(12, 0, 0, 0);
  const dow = result.getDay(); // 0=Sun
  const offset = dow === 0 ? 1 : dow === 1 ? 0 : 8 - dow;
  result.setDate(result.getDate() + offset);
  return result;
}

/** Ensure every node in the plan tree has required fields so downstream
 *  code never hits undefined.toLowerCase() or similar. Also generates IDs
 *  for nodes missing them (AI sometimes omits them), normalizes snake_case
 *  fields from the AI, and defaults numeric/boolean fields.
 *
 *  LABEL ENFORCEMENT: Validates that labels follow the canonical format
 *  (day = ISO date, week = date range, month = "Month Year", year = "YYYY").
 *  If the AI produced generic labels ("Week 1", "Monday", etc.), computes
 *  actual dates by walking weeks sequentially from the earliest found date
 *  or from today.
 *
 *  Mutates the plan in place and returns it for convenience. */
export function normalizePlan(plan: GoalPlan): GoalPlan {
  if (!plan) return plan;
  if (!Array.isArray(plan.milestones)) plan.milestones = [];
  if (!Array.isArray(plan.years)) plan.years = [];

  for (const ms of plan.milestones) {
    ms.id = ms.id || genId("ms");
    ms.title = ms.title ?? "";
    ms.description = ms.description ?? "";
    ms.targetDate = ms.targetDate ?? "";
    ms.completed = Boolean(ms.completed);
  }

  for (const yr of plan.years) {
    yr.id = yr.id || genId("year");
    yr.label = yr.label ?? "";
    yr.objective = yr.objective ?? "";
    if (!Array.isArray(yr.months)) yr.months = [];
    for (const mo of yr.months) {
      mo.id = mo.id || genId("month");
      mo.label = mo.label ?? "";
      mo.objective = mo.objective ?? "";
      if (!Array.isArray(mo.weeks)) mo.weeks = [];
      for (const wk of mo.weeks) {
        wk.id = wk.id || genId("week");
        wk.label = wk.label ?? "";
        wk.objective = wk.objective ?? "";
        if (!Array.isArray(wk.days)) wk.days = [];
        // Default locked: weeks with tasks are unlocked, empty weeks are locked
        if (wk.locked === undefined || wk.locked === null) {
          const hasTasks = wk.days.some(
            (d) => Array.isArray(d.tasks) && d.tasks.length > 0,
          );
          wk.locked = !hasTasks;
        }
        for (const dy of wk.days) {
          dy.id = dy.id || genId("day");
          dy.label = dy.label ?? "";
          if (!Array.isArray(dy.tasks)) dy.tasks = [];
          for (const t of dy.tasks) {
            t.id = t.id || genId("task");
            t.title = t.title ?? "";
            t.description = t.description ?? "";
            t.completed = Boolean(t.completed);
            // Handle snake_case fields the AI might produce
            const raw = t as unknown as Record<string, unknown>;
            if (!t.durationMinutes && raw.duration_minutes) {
              t.durationMinutes = raw.duration_minutes as number;
            }
            t.durationMinutes = t.durationMinutes || 30;
            t.priority = t.priority ?? "should-do";
            t.category = t.category ?? "planning";
          }
        }
      }
    }
  }

  // ── Label enforcement: compute proper date-based labels ──
  // Walk every week in order. If any labels are generic ("Week 1",
  // "Monday", etc.), compute actual dates from the earliest ISO day
  // label found, or from today as fallback.
  _enforceDateLabels(plan);

  return plan;
}

/** Walk the plan and replace generic labels with computed date labels.
 *  Finds the earliest ISO day label or uses today, then walks every week
 *  in sequence assigning Monday-based dates. */
function _enforceDateLabels(plan: GoalPlan): void {
  // 1. Scan all day labels to find the earliest ISO date and detect
  //    whether any labels are generic.
  let earliestDate: Date | null = null;
  let hasGenericLabels = false;
  let globalWeekIndex = 0;

  for (const yr of plan.years) {
    for (const mo of yr.months) {
      for (const wk of mo.weeks) {
        if (isGenericWeekLabel(wk.label)) hasGenericLabels = true;
        for (const dy of wk.days) {
          if (isISODate(dy.label)) {
            const d = new Date(dy.label + "T12:00:00");
            if (!isNaN(d.getTime()) && (!earliestDate || d < earliestDate)) {
              earliestDate = d;
            }
          } else if (isGenericDayLabel(dy.label)) {
            hasGenericLabels = true;
          }
        }
      }
    }
  }

  // Nothing to fix if all labels are already proper
  if (!hasGenericLabels) return;

  // 2. Determine the base Monday: the Monday of the week containing the
  //    earliest ISO date, or the next Monday from today.
  let baseMon: Date;
  if (earliestDate) {
    const dow = earliestDate.getDay(); // 0=Sun, 1=Mon, …, 6=Sat
    baseMon = new Date(earliestDate);
    if (dow === 0) {
      // Sunday → go back 6 days to get Monday
      baseMon.setDate(baseMon.getDate() - 6);
    } else {
      // Mon(1)→0, Tue(2)→-1, … Sat(6)→-5
      baseMon.setDate(baseMon.getDate() - (dow - 1));
    }
    baseMon.setHours(12, 0, 0, 0);
  } else {
    baseMon = nextMonday(new Date());
  }

  // 3. Walk every week sequentially and assign dates
  globalWeekIndex = 0;
  for (const yr of plan.years) {
    for (const mo of yr.months) {
      for (const wk of mo.weeks) {
        const weekMon = new Date(baseMon);
        weekMon.setDate(weekMon.getDate() + globalWeekIndex * 7);

        // Fix day labels
        for (let di = 0; di < wk.days.length; di++) {
          const dy = wk.days[di];
          if (!isISODate(dy.label)) {
            const dayDate = new Date(weekMon);
            dayDate.setDate(dayDate.getDate() + di);
            dy.label = dayDate.toISOString().split("T")[0];
          }
        }

        // Fix week label
        if (isGenericWeekLabel(wk.label)) {
          const numDays = Math.max(wk.days.length, 5);
          const weekEnd = new Date(weekMon);
          weekEnd.setDate(weekEnd.getDate() + numDays - 1);
          wk.label = `${fmtShort(weekMon)} – ${fmtShort(weekEnd)}`;
        }

        globalWeekIndex++;
      }

      // Fix month label
      if (isGenericMonthLabel(mo.label)) {
        // Derive from first week's Monday
        const firstWeekForMonth = mo.weeks[0];
        if (firstWeekForMonth) {
          // Find the first day label (should now be ISO)
          const firstDay = firstWeekForMonth.days[0];
          if (firstDay && isISODate(firstDay.label)) {
            const d = new Date(firstDay.label + "T12:00:00");
            mo.label = `${FULL_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
          }
        }
      }
    }

    // Fix year label
    if (isGenericYearLabel(yr.label)) {
      const firstMonth = yr.months[0];
      if (firstMonth) {
        const firstWeek = firstMonth.weeks[0];
        if (firstWeek) {
          const firstDay = firstWeek.days[0];
          if (firstDay && isISODate(firstDay.label)) {
            const d = new Date(firstDay.label + "T12:00:00");
            yr.label = String(d.getFullYear());
          } else {
            // For locked weeks with no days, derive from global week index
            // Calculate the Monday of the first week in this year
            const yearStartIdx = _getGlobalWeekIndex(plan, yr.months[0]?.weeks[0]);
            if (yearStartIdx >= 0) {
              const wd = new Date(baseMon);
              wd.setDate(wd.getDate() + yearStartIdx * 7);
              yr.label = String(wd.getFullYear());
            }
          }
        }
      }
    }
  }
}

/** Helper: find the global sequential index of a specific week in the plan. */
function _getGlobalWeekIndex(plan: GoalPlan, targetWk: GoalPlanWeek | undefined): number {
  if (!targetWk) return -1;
  let idx = 0;
  for (const yr of plan.years) {
    for (const mo of yr.months) {
      for (const wk of mo.weeks) {
        if (wk === targetWk) return idx;
        idx++;
      }
    }
  }
  return -1;
}

/** Replace all nodes for a goal with the flattened representation of
 *  `plan`. Used by regenerate-goal-plan: wipes the old tree and writes
 *  the new one under the same goal. */
export async function replacePlan(
  goalId: string,
  plan: GoalPlan,
): Promise<void> {
  normalizePlan(plan);
  await deleteForGoal(goalId);
  const nodes = flattenPlan(goalId, plan);
  if (nodes.length > 0) {
    await upsertNodes(goalId, nodes);
  }
}

// ── Pure helper: flat rows → hierarchical GoalPlan ──────────────

/** Reconstruct the nested @northstar/core GoalPlan shape from a flat list
 *  of nodes (as returned by listForGoal). Pure function — no DB access.
 *  Tolerant of missing intermediate nodes: builds whatever it can. */
export function reconstructPlan(nodes: GoalPlanNode[]): GoalPlan {
  const byId = new Map<string, GoalPlanNode>();
  for (const n of nodes) byId.set(n.id, n);

  const childrenOf = (parentId: string | null): GoalPlanNode[] =>
    nodes
      .filter((n) => n.parentId === parentId)
      .sort((a, b) => a.orderIndex - b.orderIndex);

  const milestones: GoalPlanMilestone[] = nodes
    .filter((n) => n.nodeType === "milestone")
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((n) => ({
      id: n.id,
      title: n.title,
      description: n.description,
      targetDate: (n.payload.targetDate as string) ?? n.endDate ?? "",
      completed: Boolean(n.payload.completed),
      totalTasks: n.payload.totalTasks as number | undefined,
      completedTasks: n.payload.completedTasks as number | undefined,
    }));

  const years: GoalPlanYear[] = nodes
    .filter((n) => n.nodeType === "year" && n.parentId === null)
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((yearNode) => {
      const months: GoalPlanMonth[] = childrenOf(yearNode.id)
        .filter((n) => n.nodeType === "month")
        .map((monthNode) => {
          const weeks: GoalPlanWeek[] = childrenOf(monthNode.id)
            .filter((n) => n.nodeType === "week")
            .map((weekNode) => {
              const days: GoalPlanDay[] = childrenOf(weekNode.id)
                .filter((n) => n.nodeType === "day")
                .map((dayNode) => {
                  const tasks: GoalPlanTask[] = childrenOf(dayNode.id)
                    .filter((n) => n.nodeType === "task")
                    .map((taskNode) => ({
                      id: taskNode.id,
                      title: taskNode.title,
                      description: taskNode.description,
                      durationMinutes:
                        (taskNode.payload.durationMinutes as number) ?? 0,
                      priority:
                        (taskNode.payload
                          .priority as GoalPlanTask["priority"]) ?? "should-do",
                      category:
                        (taskNode.payload
                          .category as GoalPlanTask["category"]) ?? "planning",
                      completed: Boolean(taskNode.payload.completed),
                      completedAt: taskNode.payload.completedAt as
                        | string
                        | undefined,
                    }));
                  return {
                    id: dayNode.id,
                    label:
                      (dayNode.payload.label as string) ??
                      dayNode.title ??
                      "",
                    tasks,
                  };
                });
              return {
                id: weekNode.id,
                label:
                  (weekNode.payload.label as string) ?? weekNode.title ?? "",
                objective: (weekNode.payload.objective as string) ?? "",
                locked: Boolean(weekNode.payload.locked),
                days,
              };
            });
          return {
            id: monthNode.id,
            label:
              (monthNode.payload.label as string) ?? monthNode.title ?? "",
            objective: (monthNode.payload.objective as string) ?? "",
            weeks,
          };
        });
      return {
        id: yearNode.id,
        label: (yearNode.payload.label as string) ?? yearNode.title ?? "",
        objective: (yearNode.payload.objective as string) ?? "",
        months,
      };
    });

  return { milestones, years };
}
