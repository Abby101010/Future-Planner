/* Starward server — LLM usage logger
 *
 * Records every Anthropic SDK call into the `llm_calls` ledger. Wired
 * via a Proxy around the SDK client returned by `ai/client.getClient()`,
 * so all 20+ call sites are captured without per-site changes.
 *
 * Per-call metadata (kind, trigger) flows through an AsyncLocalStorage
 * context (`llmCallContext`). Callers may opt in to richer labelling by
 * wrapping their work with `withLlmCallContext({ kind, trigger }, fn)`.
 * Calls made without a context still get logged, just with `kind`
 * derived from a best-effort heuristic and trigger=null.
 *
 * Failure-tolerant by design: insert errors are caught and logged so
 * an llm_calls write never breaks the user-facing AI response. Losing
 * a row is a soft failure; halting an in-flight call is a hard one.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type Anthropic from "@anthropic-ai/sdk";
import { llmCostCents, isModelPriced } from "@starward/core";
import * as repos from "../repositories";
import { tryGetCurrentUserId } from "../middleware/requestContext";

interface LlmCallContext {
  /** Coarse-grained label for which agent/handler made the call. */
  kind: string;
  /** Originating user-facing event (e.g. "user-refresh", "daily-rollover"). */
  trigger?: string;
  /** Free-form metadata to land in payload jsonb. */
  extra?: Record<string, unknown>;
}

const ctxStore = new AsyncLocalStorage<LlmCallContext>();

/** Wrap a body of work so any LLM calls inside inherit the given
 *  metadata. Nested calls override outer values per-key. */
export function withLlmCallContext<T>(
  ctx: LlmCallContext,
  fn: () => T,
): T {
  const parent = ctxStore.getStore();
  const merged: LlmCallContext = parent
    ? { ...parent, ...ctx, extra: { ...parent.extra, ...ctx.extra } }
    : ctx;
  return ctxStore.run(merged, fn);
}

interface UsageRecord {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

interface MessageLikeResponse {
  id?: string;
  model?: string;
  usage?: UsageRecord;
}

/** Log a completed messages.create response. Safe to await or fire-
 *  and-forget — the function always resolves and never throws. */
export async function logMessageResponse(
  response: MessageLikeResponse,
  durationMs: number,
  fallbackKind = "unknown",
): Promise<void> {
  try {
    if (!tryGetCurrentUserId()) return; // outside a request — skip
    const ctx = ctxStore.getStore();
    const usage = response.usage ?? {};
    const model = response.model ?? "unknown";
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const cacheCreate = usage.cache_creation_input_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;

    const costCents = llmCostCents(model, {
      inputTokens,
      outputTokens,
      cacheCreationInputTokens: cacheCreate,
      cacheReadInputTokens: cacheRead,
    });

    if (!isModelPriced(model)) {
      console.warn(`[llm-usage] unpriced model "${model}" — used fallback rates`);
    }

    await repos.llmCalls.insert({
      id: response.id ?? cryptoRandomId(),
      kind: ctx?.kind ?? fallbackKind,
      model,
      inputTokens,
      outputTokens,
      cacheCreationInputTokens: cacheCreate,
      cacheReadInputTokens: cacheRead,
      costCents,
      durationMs,
      requestId: response.id ?? null,
      trigger: ctx?.trigger ?? null,
      payload: ctx?.extra ?? {},
    });
  } catch (err) {
    console.warn("[llm-usage] insert failed:", err);
  }
}

function cryptoRandomId(): string {
  // Fallback when the SDK didn't supply a response.id (shouldn't happen
  // in practice but guards against pathological cases).
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Wrap an Anthropic client so every messages.create / messages.stream
 *  completion is logged via logMessageResponse. The wrapped client is
 *  shape-compatible with the original — callers see no behavior change.
 *
 *  Streaming: the proxy attaches to `finalMessage()` which the SDK
 *  resolves once the stream completes (with the same usage shape as
 *  the non-streaming call). */
export function wrapClientWithLogging(
  client: Anthropic,
): Anthropic {
  // Proxy the `messages` namespace specifically — that's where create
  // and stream live. Other client surface (beta, completions) passes
  // through untouched.
  const messages = client.messages;
  const wrappedMessages = new Proxy(messages, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (prop === "create" && typeof orig === "function") {
        return async function (...args: unknown[]) {
          const t0 = Date.now();
          const response = await (orig as (...a: unknown[]) => Promise<MessageLikeResponse>).apply(target, args);
          // Fire-and-forget; never await for the response path
          void logMessageResponse(response, Date.now() - t0, "messages.create");
          return response;
        };
      }
      if (prop === "stream" && typeof orig === "function") {
        return function (...args: unknown[]) {
          const t0 = Date.now();
          const stream = (orig as (...a: unknown[]) => unknown).apply(target, args) as {
            finalMessage?: () => Promise<MessageLikeResponse>;
          };
          // finalMessage() resolves when the stream terminates. Attach
          // a listener that does the logging after-the-fact, so the
          // synchronous return path stays unchanged.
          if (typeof stream.finalMessage === "function") {
            stream.finalMessage()
              .then((final) => logMessageResponse(final, Date.now() - t0, "messages.stream"))
              .catch(() => { /* stream errored or was cancelled — skip */ });
          }
          return stream;
        };
      }
      return orig;
    },
  });

  // Proxy the top-level client so consumers reading client.messages get
  // the wrapped namespace; everything else is identity.
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "messages") return wrappedMessages;
      return Reflect.get(target, prop, receiver);
    },
  });
}
