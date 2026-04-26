/* Starward server — llm_calls repository
 *
 * Append-only ledger of every Anthropic SDK call made on behalf of a
 * user. One row per messages.create / messages.stream completion.
 *
 * Cost is computed at insert time via @starward/core llmCostCents and
 * stored as a numeric column. The price table changes here will not
 * retroactively rewrite history — what was logged was the price-of-
 * record at the time of the call.
 *
 * The companion `services/llmUsageLogger.ts` is the only module that
 * should call insert() directly. Other code reads aggregates via the
 * (later) cost view / surface.
 */

import { query } from "../db/pool";
import { requireUserId } from "./_context";

export interface InsertLlmCallInput {
  id: string;
  kind: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  costCents: number;
  durationMs?: number | null;
  requestId?: string | null;
  trigger?: string | null;
  payload?: Record<string, unknown>;
}

export async function insert(input: InsertLlmCallInput): Promise<void> {
  const userId = requireUserId();
  await query(
    `insert into llm_calls (
       id, user_id, kind, model,
       input_tokens, output_tokens,
       cache_creation_input_tokens, cache_read_input_tokens,
       cost_cents, duration_ms, request_id, trigger, payload
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb
     )
     on conflict (user_id, id) do nothing`,
    [
      input.id,
      userId,
      input.kind,
      input.model,
      input.inputTokens,
      input.outputTokens,
      input.cacheCreationInputTokens ?? 0,
      input.cacheReadInputTokens ?? 0,
      input.costCents,
      input.durationMs ?? null,
      input.requestId ?? null,
      input.trigger ?? null,
      JSON.stringify(input.payload ?? {}),
    ],
  );
}

export interface LlmCallSummaryRow {
  kind: string;
  callCount: number;
  totalCostCents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

/** Aggregate cost grouped by kind for the requesting user, over the
 *  last `days` days. Backs analytics surfaces and the eventual
 *  classifier-threshold recalibration. */
export async function summarizeByKind(
  days: number = 30,
): Promise<LlmCallSummaryRow[]> {
  const userId = requireUserId();
  const rows = await query<{
    kind: string;
    call_count: string;
    total_cost_cents: string;
    total_input_tokens: string;
    total_output_tokens: string;
  }>(
    `select kind,
            count(*)::text                  as call_count,
            coalesce(sum(cost_cents), 0)::text as total_cost_cents,
            coalesce(sum(input_tokens), 0)::text as total_input_tokens,
            coalesce(sum(output_tokens), 0)::text as total_output_tokens
       from llm_calls
      where user_id = $1
        and created_at >= now() - ($2 || ' days')::interval
      group by kind
      order by total_cost_cents desc`,
    [userId, days],
  );
  return rows.map((r) => ({
    kind: r.kind,
    callCount: Number(r.call_count),
    totalCostCents: Number(r.total_cost_cents),
    totalInputTokens: Number(r.total_input_tokens),
    totalOutputTokens: Number(r.total_output_tokens),
  }));
}
