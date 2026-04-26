/* Starward server — plan_adjustments repository
 *
 * Append-only audit log of every escalation-classifier decision and
 * the actions it dispatched. One row per adjustment event, regardless
 * of which level (L0-L3) was used.
 *
 * Joined to llm_calls via `llm_call_ids[]` for end-to-end cost
 * attribution: "this rollover used 3 LLM calls totalling 0.42 cents."
 *
 * No update / delete from app code. The future plan-history viewer
 * reads via list helpers; threshold recalibration reads via
 * summarizeByLevel.
 */

import { query } from "../db/pool";
import { requireUserId } from "./_context";
import { parseJson } from "./_json";

export type AdjustmentLevel = 0 | 1 | 2 | 3;
export type AdjustmentScope = "task" | "day" | "milestone" | "plan";

export interface InsertPlanAdjustmentInput {
  id: string;
  goalId?: string | null;
  level: AdjustmentLevel;
  scope: AdjustmentScope;
  classifierInput: Record<string, unknown>;
  rationale: string;
  /** Array of `{ kind, nodeId?, fromDate?, toDate?, ... }` records.
   *  Free-shape so future action types don't require a migration. */
  actions: Record<string, unknown>[];
  /** IDs of llm_calls rows attributable to this adjustment. Empty
   *  array for L0 (zero-AI) events. */
  llmCallIds?: string[];
}

export interface PlanAdjustmentRecord {
  id: string;
  goalId: string | null;
  level: AdjustmentLevel;
  scope: AdjustmentScope;
  classifierInput: Record<string, unknown>;
  rationale: string;
  actions: Record<string, unknown>[];
  llmCallIds: string[];
  createdAt: string;
}

interface PlanAdjustmentRow {
  id: string;
  user_id: string;
  goal_id: string | null;
  level: number;
  scope: string;
  classifier_input: Record<string, unknown> | string | null;
  rationale: string;
  actions: Record<string, unknown>[] | string | null;
  llm_call_ids: string[];
  created_at: string;
}

function rowToRecord(r: PlanAdjustmentRow): PlanAdjustmentRecord {
  const actionsParsed = parseJson(r.actions);
  return {
    id: r.id,
    goalId: r.goal_id,
    level: r.level as AdjustmentLevel,
    scope: r.scope as AdjustmentScope,
    classifierInput: parseJson(r.classifier_input),
    rationale: r.rationale,
    actions: Array.isArray(actionsParsed)
      ? (actionsParsed as Record<string, unknown>[])
      : [],
    llmCallIds: r.llm_call_ids ?? [],
    createdAt: r.created_at,
  };
}

export async function insert(input: InsertPlanAdjustmentInput): Promise<void> {
  const userId = requireUserId();
  await query(
    `insert into plan_adjustments (
       id, user_id, goal_id, level, scope,
       classifier_input, rationale, actions, llm_call_ids
     ) values (
       $1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9
     )
     on conflict (user_id, id) do nothing`,
    [
      input.id,
      userId,
      input.goalId ?? null,
      input.level,
      input.scope,
      JSON.stringify(input.classifierInput),
      input.rationale,
      JSON.stringify(input.actions),
      input.llmCallIds ?? [],
    ],
  );
}

export async function listRecent(limit = 50): Promise<PlanAdjustmentRecord[]> {
  const userId = requireUserId();
  const rows = await query<PlanAdjustmentRow>(
    `select * from plan_adjustments
       where user_id = $1
       order by created_at desc
       limit $2`,
    [userId, limit],
  );
  return rows.map(rowToRecord);
}

export interface LevelDistributionRow {
  level: AdjustmentLevel;
  count: number;
}

/** Distribution of events by level over the last `days`. Used to
 *  validate whether the classifier is hitting its target distribution
 *  (~90 / 8 / 2 / <1 across L0/L1/L2/L3). */
export async function summarizeByLevel(
  days = 30,
): Promise<LevelDistributionRow[]> {
  const userId = requireUserId();
  const rows = await query<{ level: number; count: string }>(
    `select level, count(*)::text as count
       from plan_adjustments
      where user_id = $1
        and created_at >= now() - ($2 || ' days')::interval
      group by level
      order by level asc`,
    [userId, days],
  );
  return rows.map((r) => ({
    level: r.level as AdjustmentLevel,
    count: Number(r.count),
  }));
}
