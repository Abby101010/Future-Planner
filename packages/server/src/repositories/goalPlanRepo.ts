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

function parseJson(v: unknown): Record<string, unknown> {
  if (!v) return {};
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return v as Record<string, unknown>;
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
