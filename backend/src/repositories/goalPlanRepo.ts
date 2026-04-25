/* Starward server — goal plan nodes repository
 *
 * Wraps `goal_plan_nodes` (migration 0002), which stores the hierarchical
 * GoalPlan { milestones, years[ months[ weeks[ days[ tasks[] ] ] ] ] } as a
 * single recursive table keyed by (user_id, id) with parent_id pointing at
 * the containing node.
 *
 * This module ships a pure helper `reconstructPlan` that folds a flat list
 * of rows back into the nested @starward/core GoalPlan shape — view
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
} from "@starward/core";
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

/**
 * Move a task node to a different day in the plan tree. Finds or creates
 * a day node for `targetDate` under the appropriate week, then reparents
 * the task node. Used when a daily_task with a plan_node_id is rescheduled
 * so the GoalPlanPage timeline reflects the move.
 */
export async function moveTaskToDate(
  taskNodeId: string,
  goalId: string,
  targetDate: string,
): Promise<void> {
  const userId = requireUserId();

  // 1. Load the task node to find its current parent (day node)
  const taskNode = await getNode(taskNodeId);
  if (!taskNode || taskNode.nodeType !== "task") return;

  const currentDayId = taskNode.parentId;
  if (!currentDayId) return;

  // 2. Check if the current day already matches the target date
  const currentDay = await getNode(currentDayId);
  if (currentDay && currentDay.title === targetDate) return;
  if (currentDay && (currentDay.payload as Record<string, unknown>)?.label === targetDate) return;

  // 3. Look for an existing day node with this date in the same goal
  const existingDays = await query<GoalPlanNodeRow>(
    `select * from goal_plan_nodes
      where user_id = $1 and goal_id = $2 and node_type = 'day'
        and (title = $3 or payload->>'label' = $3)
      limit 1`,
    [userId, goalId, targetDate],
  );

  let targetDayId: string;

  if (existingDays.length > 0) {
    targetDayId = existingDays[0].id;
  } else {
    // 4. No existing day node — find the correct week to parent it under.
    //    Look for a week whose date range contains targetDate, or the
    //    closest future week. Fall back to creating under the same week
    //    as the current day.
    const weekId = currentDay?.parentId ?? null;
    targetDayId = `day-${Math.random().toString(16).slice(2, 10)}`;

    // Count existing days in the target week for order_index
    const siblingCount = weekId
      ? (await query<{ cnt: string }>(
          `select count(*) as cnt from goal_plan_nodes
            where user_id = $1 and goal_id = $2 and parent_id = $3 and node_type = 'day'`,
          [userId, goalId, weekId],
        ))[0]?.cnt ?? "0"
      : "0";

    await query(
      `insert into goal_plan_nodes (
         id, user_id, goal_id, parent_id, node_type, title, description,
         start_date, end_date, order_index, payload, updated_at
       ) values ($1, $2, $3, $4, 'day', $5, '', $5, $5, $6, $7::jsonb, now())`,
      [
        targetDayId,
        userId,
        goalId,
        weekId,
        targetDate,
        parseInt(siblingCount, 10),
        JSON.stringify({ label: targetDate }),
      ],
    );
  }

  // 5. Reparent the task node to the target day
  //    Also get the new order_index (append to end)
  const taskSiblings = await query<{ cnt: string }>(
    `select count(*) as cnt from goal_plan_nodes
      where user_id = $1 and goal_id = $2 and parent_id = $3 and node_type = 'task'`,
    [userId, goalId, targetDayId],
  );
  const newOrder = parseInt(taskSiblings[0]?.cnt ?? "0", 10);

  await query(
    `update goal_plan_nodes
        set parent_id = $3,
            order_index = $4,
            updated_at = now()
      where user_id = $1 and id = $2`,
    [userId, taskNodeId, targetDayId, newOrder],
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
export function normalizePlan(plan: GoalPlan, startDate?: string, endDate?: string): GoalPlan {
  if (!plan) return plan;
  if (!Array.isArray(plan.milestones)) plan.milestones = [];
  if (!Array.isArray(plan.years)) plan.years = [];

  for (const ms of plan.milestones) {
    // Always regenerate IDs to avoid cross-goal collisions in the DB
    // (DB primary key is (user_id, id), shared IDs cause data corruption)
    ms.id = genId("ms");
    ms.title = ms.title ?? "";
    ms.description = ms.description ?? "";
    ms.targetDate = ms.targetDate ?? "";
    ms.completed = Boolean(ms.completed);
  }

  for (const yr of plan.years) {
    yr.id = genId("year");
    yr.label = yr.label ?? "";
    yr.objective = yr.objective ?? "";
    if (!Array.isArray(yr.months)) yr.months = [];
    for (const mo of yr.months) {
      mo.id = genId("month");
      mo.label = mo.label ?? "";
      mo.objective = mo.objective ?? "";
      if (!Array.isArray(mo.weeks)) mo.weeks = [];
      for (const wk of mo.weeks) {
        wk.id = genId("week");
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
          dy.id = genId("day");
          dy.label = dy.label ?? "";
          if (!Array.isArray(dy.tasks)) dy.tasks = [];
          for (const t of dy.tasks) {
            t.id = genId("task");
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

  // ── ID deduplication: ensure every node ID is unique within this plan.
  // AI-generated plans can reuse IDs across goals (e.g. "year-f6a7b8c9").
  // The DB primary key is (user_id, id) so shared IDs cause cross-goal
  // data corruption. Regenerate any duplicate IDs.
  const seenIds = new Set<string>();
  for (const ms of plan.milestones) {
    if (seenIds.has(ms.id)) ms.id = genId("ms");
    seenIds.add(ms.id);
  }
  for (const yr of plan.years) {
    if (seenIds.has(yr.id)) yr.id = genId("year");
    seenIds.add(yr.id);
    for (const mo of yr.months) {
      if (seenIds.has(mo.id)) mo.id = genId("month");
      seenIds.add(mo.id);
      for (const wk of mo.weeks) {
        if (seenIds.has(wk.id)) wk.id = genId("week");
        seenIds.add(wk.id);
        for (const dy of wk.days) {
          if (seenIds.has(dy.id)) dy.id = genId("day");
          seenIds.add(dy.id);
          for (const t of dy.tasks) {
            if (seenIds.has(t.id)) t.id = genId("task");
            seenIds.add(t.id);
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

  // Gap-fill removed: empty stub weeks/months clutter the UI and cause
  // cross-month pollution (e.g. "May 1–4" appearing under April).
  // The plan only needs structural nodes where tasks actually exist.

  return plan;
}

/** Ensure every week, month, and year from startDate to endDate exists
 *  in the plan. Missing structural nodes are inserted as stubs with
 *  proper labels. Empty days get an ISO date label and empty tasks[].
 *  This guarantees the timeline is always a complete grid. */
function _fillTimelineGaps(plan: GoalPlan, startDate: string, endDate: string): void {
  const start = new Date(startDate + "T12:00:00");
  const end = new Date(endDate + "T12:00:00");
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) return;

  // 1. Compute the Monday of the start week
  const startDow = start.getDay();
  const startMon = new Date(start);
  if (startDow === 0) startMon.setDate(startMon.getDate() - 6);
  else startMon.setDate(startMon.getDate() - (startDow - 1));
  startMon.setHours(12, 0, 0, 0);

  // 2. Build the expected calendar grid: { year → { month → weeks[] } }
  type WeekSlot = { mon: Date; label: string; dayLabels: string[] };
  type MonthSlot = { label: string; yearNum: number; monthNum: number; weeks: WeekSlot[] };
  const monthMap = new Map<string, MonthSlot>();
  const yearSet = new Set<number>();

  const cursor = new Date(startMon);
  while (cursor <= end) {
    const mon = new Date(cursor);
    const fri = new Date(mon);
    fri.setDate(fri.getDate() + 4);
    const weekLabel = `${fmtShort(mon)} – ${fmtShort(fri)}`;

    // Determine which month this week belongs to (use Monday's month)
    const mKey = `${FULL_MONTHS[mon.getMonth()]} ${mon.getFullYear()}`;
    yearSet.add(mon.getFullYear());

    if (!monthMap.has(mKey)) {
      monthMap.set(mKey, {
        label: mKey,
        yearNum: mon.getFullYear(),
        monthNum: mon.getMonth(),
        weeks: [],
      });
    }

    // Build 7 day labels (Mon-Sun) for this week
    const dayLabels: string[] = [];
    for (let d = 0; d < 7; d++) {
      const dayDate = new Date(mon);
      dayDate.setDate(dayDate.getDate() + d);
      dayLabels.push(dayDate.toISOString().split("T")[0]);
    }

    monthMap.get(mKey)!.weeks.push({ mon, label: weekLabel, dayLabels });
    cursor.setDate(cursor.getDate() + 7);
  }

  // 3. Index existing plan nodes by date for matching
  const existingWeekStarts = new Set<string>(); // Mon ISO dates of existing weeks
  const existingMonthKeys = new Set<string>(); // "Month Year" labels
  const existingYearLabels = new Set<string>();

  for (const yr of plan.years) {
    existingYearLabels.add(yr.label);
    for (const mo of yr.months) {
      existingMonthKeys.add(mo.label);
      for (const wk of mo.weeks) {
        // Try to extract the Monday date from the week label or first day
        const firstDay = wk.days?.[0];
        if (firstDay && isISODate(firstDay.label)) {
          const d = new Date(firstDay.label + "T12:00:00");
          const dow = d.getDay();
          const monDate = new Date(d);
          if (dow === 0) monDate.setDate(monDate.getDate() - 6);
          else monDate.setDate(monDate.getDate() - (dow - 1));
          existingWeekStarts.add(monDate.toISOString().split("T")[0]);
        } else {
          // Try parsing the week label "Apr 14 – Apr 18"
          const m = wk.label.match(
            /([A-Za-z]+)\s+(\d{1,2})\s*[–\-]\s*([A-Za-z]+)\s+(\d{1,2})/,
          );
          if (m) {
            // Use start year from the plan context
            for (const tryYear of yearSet) {
              const testDate = new Date(`${m[1]} ${m[2]}, ${tryYear}`);
              if (!isNaN(testDate.getTime())) {
                const dow = testDate.getDay();
                const monDate = new Date(testDate);
                if (dow === 0) monDate.setDate(monDate.getDate() - 6);
                else monDate.setDate(monDate.getDate() - (dow - 1));
                existingWeekStarts.add(monDate.toISOString().split("T")[0]);
                break;
              }
            }
          }
        }
      }
    }
  }

  // 4. Insert missing nodes
  for (const yearNum of yearSet) {
    const yearLabel = String(yearNum);
    let yearNode = plan.years.find((yr) => yr.label === yearLabel);
    if (!yearNode) {
      yearNode = {
        id: genId("year"),
        label: yearLabel,
        objective: "",
        months: [],
      };
      plan.years.push(yearNode);
    }

    // Sort months for this year
    const monthsForYear = [...monthMap.values()]
      .filter((ms) => ms.yearNum === yearNum)
      .sort((a, b) => a.monthNum - b.monthNum);

    for (const ms of monthsForYear) {
      let monthNode = yearNode.months.find((mo) => mo.label === ms.label);
      if (!monthNode) {
        monthNode = {
          id: genId("month"),
          label: ms.label,
          objective: "",
          weeks: [],
        };
        yearNode.months.push(monthNode);
      }

      for (const ws of ms.weeks) {
        const monISO = ws.mon.toISOString().split("T")[0];
        if (existingWeekStarts.has(monISO)) continue;

        // Insert stub week with day slots
        const days: GoalPlanDay[] = ws.dayLabels.map((dl) => ({
          id: genId("day"),
          label: dl,
          tasks: [],
        }));

        monthNode.weeks.push({
          id: genId("week"),
          label: ws.label,
          objective: "",
          locked: true,
          days,
        });
        existingWeekStarts.add(monISO);
      }

      // Sort weeks within month by first day date
      monthNode.weeks.sort((a, b) => {
        const aDate = a.days?.[0]?.label ?? "";
        const bDate = b.days?.[0]?.label ?? "";
        return aDate.localeCompare(bDate);
      });
    }

    // Sort months within year by month number
    yearNode.months.sort((a, b) => {
      const aIdx = FULL_MONTHS.findIndex((m) => a.label.startsWith(m));
      const bIdx = FULL_MONTHS.findIndex((m) => b.label.startsWith(m));
      return aIdx - bIdx;
    });
  }

  // Sort years
  plan.years.sort((a, b) => a.label.localeCompare(b.label));
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
 *  `plan`. Used by regenerate-goal-plan, by the goal-plan-chat stream
 *  on full replacement / patch / replan, and by adaptive reschedule.
 *
 *  ⚠ Invariant: if the goal is already `planConfirmed`, this call also
 *  prunes any orphan `daily_tasks` rows (rows whose plan_node_id no
 *  longer exists in the rewritten tree) and re-materializes the
 *  14-day rolling horizon. That way chat-driven plan edits propagate
 *  to the Tasks page and Calendar automatically — callers do NOT need
 *  to remember to call the materializer. Unconfirmed goals (still in
 *  initial planning) are left alone: no orphan prune, no materialize.
 *
 *  The `goals` repo is imported inside the function to avoid a
 *  circular import at module load time (goalsRepo → goalPlanRepo is
 *  not a path today, but this keeps the graph safe). Same for the
 *  service imports. */
export async function replacePlan(
  goalId: string,
  plan: GoalPlan,
  startDate?: string,
  endDate?: string,
): Promise<void> {
  normalizePlan(plan, startDate, endDate);
  await deleteForGoal(goalId);
  const nodes = flattenPlan(goalId, plan);
  if (nodes.length > 0) {
    await upsertNodes(goalId, nodes);
  }

  // Auto-sync daily_tasks for confirmed plans. Skip for unconfirmed goals
  // (initial planning iterations) so we don't pollute the Tasks page
  // before the user accepts the plan.
  try {
    const { get: getGoal } = await import("./goalsRepo");
    const goal = await getGoal(goalId);
    if (goal?.planConfirmed) {
      const { pruneOrphanedPlanTasks, materializePlanTasks } = await import(
        "../services/planMaterialization"
      );
      await pruneOrphanedPlanTasks(goalId);
      await materializePlanTasks(goalId, plan);
    }
  } catch (err) {
    // Materialization is a side-effect — never block plan persistence
    // on a materialization failure. Log and move on; cmdConfirmGoalPlan
    // or the next adaptive-reschedule will retry.
    console.warn(
      `[goalPlanRepo.replacePlan] post-write materialization failed for goal ${goalId}:`,
      err,
    );
  }
}

// ── Pure helper: flat rows → hierarchical GoalPlan ──────────────

/** Reconstruct the nested @starward/core GoalPlan shape from a flat list
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

// ── Calendar / daily-planner integration ─────────────────

export interface GoalPlanTaskForCalendar {
  id: string;
  goalId: string;
  goalTitle: string;
  goalImportance: string;
  title: string;
  description: string;
  date: string;
  durationMinutes: number;
  priority: string;
  category: string;
  completed: boolean;
  completedAt?: string;
}

/**
 * Find all task-type plan nodes whose parent day node falls within
 * a date range. Joins against the goals table to include the goal title.
 */
export async function listTasksForDateRange(
  startDate: string,
  endDate: string,
): Promise<GoalPlanTaskForCalendar[]> {
  const userId = requireUserId();
  const rows = await query<
    GoalPlanNodeRow & { day_date: string; goal_title: string; goal_importance: string }
  >(
    `select t.*, d.start_date as day_date, g.title as goal_title, g.priority as goal_importance
     from goal_plan_nodes t
     join goal_plan_nodes d on d.user_id = t.user_id and d.id = t.parent_id
     join goals g on g.user_id = t.user_id and g.id = t.goal_id
     where t.user_id = $1
       and t.node_type = 'task'
       and d.node_type = 'day'
       and d.start_date >= $2
       and d.start_date <= $3
     order by d.start_date asc, t.order_index asc`,
    [userId, startDate, endDate],
  );

  return rows.map((r) => {
    const pl = parseJson(r.payload);
    return {
      id: r.id,
      goalId: r.goal_id,
      goalTitle: r.goal_title,
      goalImportance: r.goal_importance ?? "medium",
      title: r.title,
      description: r.description,
      date: r.day_date,
      durationMinutes: (pl.durationMinutes as number) ?? 30,
      priority: (pl.priority as string) ?? "should-do",
      category: (pl.category as string) ?? "planning",
      completed: (pl.completed as boolean) ?? false,
      completedAt: (pl.completedAt as string) ?? undefined,
    };
  });
}

/**
 * Find uncompleted task nodes for a specific goal (or all goals),
 * scheduled for today or overdue (not future-dated).
 * Excludes tasks that already have a daily_task row (dedup by plan_node_id).
 *
 * @param goalId - filter to a specific goal, or null for all active goals
 * @param asOfDate - only consider tasks on or before this date (today + overdue)
 * @param limit - max results to return
 */
export async function listNextUncompletedTasks(
  goalId: string | null,
  asOfDate: string,
  limit: number = 5,
): Promise<GoalPlanTaskForCalendar[]> {
  const userId = requireUserId();
  const rows = await query<
    GoalPlanNodeRow & { day_date: string; goal_title: string; goal_importance: string }
  >(
    `select t.*, d.start_date as day_date, g.title as goal_title, g.priority as goal_importance
     from goal_plan_nodes t
     join goal_plan_nodes d on d.user_id = t.user_id and d.id = t.parent_id
     join goals g on g.user_id = t.user_id and g.id = t.goal_id
     left join daily_tasks dt on dt.user_id = t.user_id and dt.plan_node_id = t.id
     where t.user_id = $1
       and t.node_type = 'task'
       and d.node_type = 'day'
       and d.start_date <= $2
       and (t.payload->>'completed')::boolean is not true
       and dt.id is null
       and g.status not in ('archived', 'completed')
       and g.plan_confirmed = true
       ${goalId ? "and t.goal_id = $4" : ""}
     order by d.start_date desc, t.order_index asc
     limit $3`,
    goalId ? [userId, asOfDate, limit, goalId] : [userId, asOfDate, limit],
  );

  return rows.map((r) => {
    const pl = parseJson(r.payload);
    return {
      id: r.id,
      goalId: r.goal_id,
      goalTitle: r.goal_title,
      goalImportance: r.goal_importance ?? "medium",
      title: r.title,
      description: r.description,
      date: r.day_date,
      durationMinutes: (pl.durationMinutes as number) ?? 30,
      priority: (pl.priority as string) ?? "should-do",
      category: (pl.category as string) ?? "planning",
      completed: false,
    };
  });
}

/**
 * Find uncompleted task nodes scheduled for the FUTURE (after `asOfDate`)
 * within `horizonDays`. Used by the smart task-rotation flow as the
 * "future-day bonus" tier — when today's pipeline (today + overdue) is
 * exhausted but the cognitive budget still has room, pull the next
 * upcoming plan task and insert it as a bonus the user can complete in
 * advance.
 *
 * Same dedup as listNextUncompletedTasks: excludes plan nodes that
 * already have a daily_tasks row, so completing the future-day plan
 * task today won't duplicate it tomorrow.
 *
 * Ordered by chronological soonest-first so we surface near-term bonus
 * candidates before far-future ones.
 */
export async function listNextFutureTasks(
  goalId: string | null,
  asOfDate: string,
  horizonDays: number = 7,
  limit: number = 5,
): Promise<GoalPlanTaskForCalendar[]> {
  const userId = requireUserId();
  const horizonEnd = new Date(asOfDate + "T00:00:00");
  horizonEnd.setDate(horizonEnd.getDate() + Math.max(1, horizonDays));
  const horizonStr = horizonEnd.toISOString().split("T")[0];

  const params: unknown[] = goalId
    ? [userId, asOfDate, horizonStr, limit, goalId]
    : [userId, asOfDate, horizonStr, limit];

  const rows = await query<
    GoalPlanNodeRow & { day_date: string; goal_title: string; goal_importance: string }
  >(
    `select t.*, d.start_date as day_date, g.title as goal_title, g.priority as goal_importance
     from goal_plan_nodes t
     join goal_plan_nodes d on d.user_id = t.user_id and d.id = t.parent_id
     join goals g on g.user_id = t.user_id and g.id = t.goal_id
     left join daily_tasks dt on dt.user_id = t.user_id and dt.plan_node_id = t.id
     where t.user_id = $1
       and t.node_type = 'task'
       and d.node_type = 'day'
       and d.start_date > $2
       and d.start_date <= $3
       and (t.payload->>'completed')::boolean is not true
       and dt.id is null
       and g.status not in ('archived', 'completed')
       and g.plan_confirmed = true
       ${goalId ? "and t.goal_id = $5" : ""}
     order by d.start_date asc, t.order_index asc
     limit $4`,
    params,
  );

  return rows.map((r) => {
    const pl = parseJson(r.payload);
    return {
      id: r.id,
      goalId: r.goal_id,
      goalTitle: r.goal_title,
      goalImportance: r.goal_importance ?? "medium",
      title: r.title,
      description: r.description,
      date: r.day_date,
      durationMinutes: (pl.durationMinutes as number) ?? 30,
      priority: (pl.priority as string) ?? "should-do",
      category: (pl.category as string) ?? "planning",
      completed: false,
    };
  });
}
