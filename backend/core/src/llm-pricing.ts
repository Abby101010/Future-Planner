/* ──────────────────────────────────────────────────────────
   Starward — LLM cost pricing

   Pure, framework-free cost calculation. Imported by the
   server-side llmUsageLogger so every Anthropic SDK call's
   token counts get converted to USD cents at insert time.

   ⚠ Prices below are best-effort snapshots — verify against
   anthropic.com/pricing before relying on the cents value
   for billing or contractual purposes. The cost_cents column
   in llm_calls is computed once at insert and never
   recomputed, so rate updates here only affect new calls.
   ────────────────────────────────────────────────────────── */

import type { ClaudeModel } from "./model-config.js";

/** USD per million tokens, separated by direction. Cache rates apply
 *  when prompt caching is in use (input_tokens for cache_read are
 *  10% of base; cache_creation is 25% premium over base input).
 *  Source: anthropic.com/pricing as of late 2025 / early 2026. */
interface ModelPriceUSDPerMTok {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Best-effort price table. Keep keyed by the exact model id strings
 *  the SDK accepts — those match the `ClaudeModel` union in
 *  model-config.ts and the `model` field on the SDK response. */
const PRICES: Record<string, ModelPriceUSDPerMTok> = {
  // Opus tier — premium reasoning
  "claude-opus-4-6":  { input: 15, output: 75, cacheRead: 1.5,  cacheWrite: 18.75 },
  "claude-opus-4-7":  { input: 15, output: 75, cacheRead: 1.5,  cacheWrite: 18.75 },

  // Sonnet tier — balanced
  "claude-sonnet-4-6": { input: 3,  output: 15, cacheRead: 0.30, cacheWrite: 3.75 },

  // Haiku tier — fast / cheap
  "claude-haiku-4-5-20251001": { input: 1, output: 5, cacheRead: 0.10, cacheWrite: 1.25 },
  "claude-haiku-4-5":           { input: 1, output: 5, cacheRead: 0.10, cacheWrite: 1.25 },
};

/** Fallback used when the SDK reports a model id we haven't priced.
 *  Defaults to Sonnet rates so unknown models don't silently free-ride
 *  in cost analytics. Logged as a soft warning by the caller. */
const FALLBACK_PRICE: ModelPriceUSDPerMTok = PRICES["claude-sonnet-4-6"];

export interface LlmUsageCounts {
  inputTokens: number;
  outputTokens: number;
  /** Optional — present when prompt caching is enabled. */
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

/**
 * Compute the USD-cent cost of a single LLM call. Returns a number
 * (not a string) so the caller can round / format as needed. Result is
 * already in cents (multiply by 1 in DB, no further conversion).
 *
 * Math:
 *   cost_usd = (input_tokens * price.input
 *             + output_tokens * price.output
 *             + cache_read * price.cacheRead
 *             + cache_creation * price.cacheWrite) / 1_000_000
 *   cost_cents = cost_usd * 100
 */
export function llmCostCents(
  model: string,
  usage: LlmUsageCounts,
): number {
  const price = PRICES[model] ?? FALLBACK_PRICE;
  const inUsd =
    (usage.inputTokens * price.input
      + usage.outputTokens * price.output
      + (usage.cacheReadInputTokens ?? 0) * price.cacheRead
      + (usage.cacheCreationInputTokens ?? 0) * price.cacheWrite) /
    1_000_000;
  return inUsd * 100;
}

/** True when a model id has explicit pricing rather than falling back.
 *  Useful for callers that want to log a soft warning on unpriced models. */
export function isModelPriced(model: string): boolean {
  return Object.prototype.hasOwnProperty.call(PRICES, model);
}

/** Re-export for type-checked usage at call sites. */
export type { ClaudeModel };
