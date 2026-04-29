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
import { llmCostCents, isModelPriced, type DevLogActor } from "@starward/core";
import * as repos from "../repositories";
import { tryGetCurrentUserId } from "../middleware/requestContext";
import { DEV_LOG_ENABLED } from "./devLog";
import { emitOperation } from "./devLog/instrument";

interface LlmCallContext {
  /** Coarse-grained label for which agent/handler made the call. */
  kind: string;
  /** Originating user-facing event (e.g. "user-refresh", "daily-rollover"). */
  trigger?: string;
  /** Free-form metadata to land in payload jsonb. */
  extra?: Record<string, unknown>;
  /** Sub-agent or handler that initiated the call. Surfaces in dev-log
   *  as `actor: "agent:<id>"` so the trace is grouped per agent. */
  agentId?: string;
  /** RAG chunks retrieved for this call. Each entry: chunk id + the
   *  first ~200 chars of its body. Surfaces in dev-log details. */
  ragChunks?: Array<{ id: string; text?: string; source?: string }>;
  /** Free-form router decision — e.g. why the coordinator picked this
   *  agent. Surfaces in dev-log details for debuggability. */
  routerReason?: string;
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

/** Pull the textual content out of a `messages.create` response. */
function extractResponseText(response: MessageLikeResponse): string {
  const content = (response as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c && typeof c === "object" && (c as Record<string, unknown>).type === "text")
    .map((c) => (c as Record<string, unknown>).text)
    .filter((t): t is string => typeof t === "string")
    .join("\n");
}

/** Pull the user-side message text out of the `messages` array passed
 *  to the SDK. Returns the most recent user turn for the dev-log. */
function extractUserMessage(params: Record<string, unknown>): string {
  const messages = params.messages;
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as Record<string, unknown> | undefined;
    if (!m) continue;
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      const text = m.content
        .filter(
          (c) =>
            c && typeof c === "object" && (c as Record<string, unknown>).type === "text",
        )
        .map((c) => (c as Record<string, unknown>).text)
        .filter((t): t is string => typeof t === "string")
        .join("\n");
      if (text) return text;
    }
  }
  return "";
}

/** Emit a dev-log entry for one completed Claude call. Best-effort —
 *  any throw is swallowed so the user-facing AI path is never affected. */
function emitDevLogForLlmCall(
  args: unknown[],
  response: MessageLikeResponse,
  durationMs: number,
  fallbackKind: string,
): void {
  if (!DEV_LOG_ENABLED) return;
  try {
    const params = (args[0] ?? {}) as Record<string, unknown>;
    const ctx = ctxStore.getStore();
    const usage = response.usage ?? {};
    const model =
      response.model ??
      (typeof params.model === "string" ? params.model : "unknown");
    const systemPrompt =
      typeof params.system === "string"
        ? params.system
        : Array.isArray(params.system)
          ? JSON.stringify(params.system)
          : "";
    const userMessage = extractUserMessage(params);
    const responseText = extractResponseText(response);
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const kind = ctx?.kind ?? fallbackKind;
    const agentLabel: DevLogActor = ctx?.agentId
      ? (`agent:${ctx.agentId}` as DevLogActor)
      : "ai";

    emitOperation({
      type: "ai",
      actor: agentLabel,
      summary: `ai ${kind} model=${model} in=${inputTokens} out=${outputTokens} (${durationMs}ms)`,
      details: {
        kind,
        trigger: ctx?.trigger,
        agentId: ctx?.agentId,
        model,
        tokens: {
          input: inputTokens,
          output: outputTokens,
          cacheCreate: usage.cache_creation_input_tokens ?? 0,
          cacheRead: usage.cache_read_input_tokens ?? 0,
        },
        systemPrompt,
        userMessage,
        response: responseText,
        ragChunks: ctx?.ragChunks,
        routerReason: ctx?.routerReason,
        responseId: response.id,
      },
      durationMs,
      status: "ok",
    });
  } catch (err) {
    // Never let logging break the user-facing AI path.
    console.warn("[dev-log] llm emit failed:", err);
  }
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
          const durationMs = Date.now() - t0;
          // Fire-and-forget; never await on the user-facing path.
          void logMessageResponse(response, durationMs, "messages.create");
          emitDevLogForLlmCall(args, response, durationMs, "messages.create");
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
              .then((final) => {
                const durationMs = Date.now() - t0;
                void logMessageResponse(final, durationMs, "messages.stream");
                emitDevLogForLlmCall(args, final, durationMs, "messages.stream");
              })
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
