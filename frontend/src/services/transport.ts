/* Starward — standardized view/command transport (Phase 5b)
 *
 * Thin client over the server's new /view/:kind and /commands/:kind routes.
 * Every response is a standardized `Envelope<T>` from @starward/core; this
 * module validates the protocol version, throws on `ok: false`, and returns
 * `envelope.data` on success.
 *
 * Coexists with the legacy `cloudTransport.ts` module — callers that still
 * use channel-based IPC should keep using that one. Phase 5b's `useQuery`
 * and `useCommand` hooks are the only callers of this file today.
 */

import type { Envelope, QueryKind, CommandKind } from "@starward/core";
import { PROTOCOL_VERSION } from "@starward/core";
import { getAuthToken } from "./auth";
import { createLogger } from "../utils/logger";
import {
  DEV_LOG_ENABLED,
  currentCorrelationId,
  emit,
  rootAction,
  withParent,
} from "./devLog";

const log = createLogger("transport");

const DEFAULT_QUERY_TIMEOUT_MS = 30_000;
// AI-backed commands (regenerate-goal-plan, reallocate, send-chat-message)
// can take well over a minute against Claude. Keep this generous — the
// server still streams progress over WS for anything interactive.
const DEFAULT_COMMAND_TIMEOUT_MS = 180_000;

const CLOUD_API_URL = (
  (import.meta.env.VITE_CLOUD_API_URL as string | undefined) || ""
).replace(/\/$/, "");

/** Strip the `view:` / `command:` prefix to produce the URL path segment. */
function kindToSlug(kind: string): string {
  const idx = kind.indexOf(":");
  return idx < 0 ? kind : kind.slice(idx + 1);
}

function baseUrl(): string {
  if (!CLOUD_API_URL) {
    throw new Error(
      "transport: VITE_CLOUD_API_URL is not set — standardized transport requires the cloud backend",
    );
  }
  return CLOUD_API_URL;
}

/**
 * Low-level envelope fetcher shared by queryView + runCommand.
 *
 * - Attaches the Bearer token from `auth.ts` on every request.
 * - Enforces an AbortController-based timeout.
 * - Verifies `response.v === PROTOCOL_VERSION` and throws on mismatch.
 * - Throws on `ok: false` with the envelope's error message.
 */
export async function fetchEnvelope<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  timeoutMs: number = DEFAULT_QUERY_TIMEOUT_MS,
): Promise<T> {
  const url = `${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  // Reuse the current root correlation ID if there is one (set by a
  // recent click / submit / nav). When called directly without an
  // upstream user action (programmatic effect, polling), mint one so
  // the server still correlates this request to a chain.
  const cid = DEV_LOG_ENABLED
    ? currentCorrelationId() || rootAction()
    : "";
  const isCommand = method === "POST" && path.startsWith("/commands/");
  const isQuery = method === "GET" && path.startsWith("/view/");
  const opType = isCommand ? "command" : isQuery ? "query" : "command";
  const slug = (() => {
    const m = path.match(/^\/(commands|view)\/([^?]+)/);
    return m ? `${m[1] === "commands" ? "command" : "view"}:${m[2]}` : path;
  })();
  const startLogId = DEV_LOG_ENABLED
    ? emit({
        type: opType,
        actor: "frontend",
        summary: `${method} ${slug}`,
        details: { method, path, body },
        status: "pending",
      })
    : "";

  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await getAuthToken()}`,
        "X-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(cid ? { "X-Correlation-Id": cid } : {}),
      },
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
      signal: controller.signal,
    });

    const elapsed = Date.now() - started;

    if (!res.ok) {
      let text = "";
      try {
        text = await res.text();
      } catch {
        /* ignore */
      }
      log.error(`${method} ${path} HTTP ${res.status} (${elapsed}ms)`, text.slice(0, 200));
      if (DEV_LOG_ENABLED) {
        withParent(startLogId, () =>
          emit({
            type: opType,
            actor: "frontend",
            summary: `${method} ${slug} ✗ HTTP ${res.status} (${elapsed}ms)`,
            details: { status: res.status, body: text.slice(0, 500) },
            durationMs: elapsed,
            status: "error",
          }),
        );
      }
      throw new Error(
        `${method} ${path} failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`,
      );
    }

    const parsed = (await res.json()) as Envelope<T>;

    if (parsed.v !== PROTOCOL_VERSION) {
      throw new Error("protocol version mismatch");
    }

    if (!parsed.ok) {
      const err = parsed.error ?? { code: "unknown", message: "command failed" };
      if (DEV_LOG_ENABLED) {
        withParent(startLogId, () =>
          emit({
            type: opType,
            actor: "frontend",
            summary: `${method} ${slug} ✗ ${err.code} (${elapsed}ms)`,
            details: { error: err, parsed },
            durationMs: elapsed,
            status: "error",
          }),
        );
      }
      throw new Error(`${parsed.kind}: ${err.code} — ${err.message}`);
    }

    log.debug(`${method} ${path} ← ok (${elapsed}ms)`);
    if (DEV_LOG_ENABLED) {
      withParent(startLogId, () =>
        emit({
          type: opType,
          actor: "frontend",
          summary: `${method} ${slug} ✓ (${elapsed}ms)`,
          details: { resultKind: parsed.kind, hasData: parsed.data !== undefined },
          durationMs: elapsed,
          status: "ok",
        }),
      );
    }
    return parsed.data as T;
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      if (DEV_LOG_ENABLED) {
        withParent(startLogId, () =>
          emit({
            type: opType,
            actor: "frontend",
            summary: `${method} ${slug} ✗ timeout after ${timeoutMs}ms`,
            details: { timeoutMs },
            durationMs: Date.now() - started,
            status: "error",
          }),
        );
      }
      throw new Error(`${method} ${path} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a view by kind. Server route: GET /view/<slug>?args=<json>.
 * Args are URL-encoded as a single `args` query parameter so the route
 * handler can parse them the same way regardless of shape.
 */
export async function queryView<T>(
  kind: QueryKind,
  args?: Record<string, unknown>,
): Promise<T> {
  const slug = kindToSlug(kind);
  const qs = args ? `?args=${encodeURIComponent(JSON.stringify(args))}` : "";
  return fetchEnvelope<T>("GET", `/view/${slug}${qs}`, undefined, DEFAULT_QUERY_TIMEOUT_MS);
}

/**
 * Run a command by kind. Server route: POST /commands/<slug> with a JSON
 * CommandRequest body. The server echoes the result as an envelope; we
 * return envelope.data on success.
 */
export async function runCommand<T>(
  kind: CommandKind,
  args: Record<string, unknown>,
): Promise<T> {
  const slug = kindToSlug(kind);
  return fetchEnvelope<T>(
    "POST",
    `/commands/${slug}`,
    { v: PROTOCOL_VERSION, kind, args },
    DEFAULT_COMMAND_TIMEOUT_MS,
  );
}

/**
 * POST raw JSON to a backend route that does NOT use the Envelope
 * protocol (e.g. /memory/*, /chat/*, /ai/*). Returns parsed JSON.
 * Throws on non-2xx with the response text attached.
 */
export async function postJson<T>(path: string, body: unknown = {}): Promise<T> {
  const url = `${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await getAuthToken()}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${path} HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`);
  }
  return (await res.json()) as T;
}

/** GET a non-envelope JSON route (e.g. /commands/job-status/:id). */
export async function getJson<T>(path: string): Promise<T> {
  const url = `${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${await getAuthToken()}`,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET ${path} HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`);
  }
  return (await res.json()) as T;
}

export interface SseStreamHandlers<TDone = unknown> {
  onDelta?: (text: string) => void;
  onDone?: (result: TDone) => void;
  onError?: (message: string) => void;
}

/**
 * POST a JSON body to an SSE endpoint and dispatch `event: delta` /
 * `event: done` / `event: error` frames to the provided handlers. Used by
 * the goal-plan chat panel to consume /ai/goal-plan-chat/stream directly
 * instead of routing through the WS-based stream path.
 *
 * Resolves once the server closes the stream; rejects on HTTP errors or
 * mid-stream `event: error` frames.
 */
export async function postSseStream<TDone = unknown>(
  path: string,
  body: unknown,
  handlers: SseStreamHandlers<TDone>,
): Promise<void> {
  const url = `${baseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  // Reuse / mint a correlation ID so chat SSE calls thread back to the
  // user click that started them. Add it as a request header so the
  // backend (when running locally with dev-log) attaches its own
  // entries to the same chain.
  const cid = DEV_LOG_ENABLED
    ? currentCorrelationId() || rootAction()
    : "";
  const sseStartLogId = DEV_LOG_ENABLED
    ? emit({
        type: "command",
        actor: "frontend",
        summary: `SSE POST ${path}`,
        details: { path, body },
        status: "pending",
      })
    : "";
  const sseStartedAt = Date.now();
  let deltaChunks = 0;
  let deltaChars = 0;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${await getAuthToken()}`,
      ...(cid ? { "X-Correlation-Id": cid } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    if (DEV_LOG_ENABLED) {
      withParent(sseStartLogId, () =>
        emit({
          type: "command",
          actor: "frontend",
          summary: `SSE POST ${path} ✗ HTTP ${res.status}`,
          details: { status: res.status, body: text.slice(0, 500) },
          durationMs: Date.now() - sseStartedAt,
          status: "error",
        }),
      );
    }
    throw new Error(
      `SSE ${path} failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamError: string | null = null;

  const dispatchFrame = (frame: string) => {
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) return;
    let data: unknown = null;
    try {
      data = JSON.parse(dataLines.join("\n"));
    } catch {
      return;
    }
    if (eventName === "delta") {
      const text = (data as { text?: string } | null)?.text ?? "";
      if (text) {
        deltaChunks++;
        deltaChars += text.length;
        handlers.onDelta?.(text);
      }
    } else if (eventName === "done") {
      // Capture the FULL done payload — this is where chat reveals
      // whether the backend returned `intents: [...]` or `intents: []`,
      // and whether `pendingActionIds` were created.
      if (DEV_LOG_ENABLED) {
        withParent(sseStartLogId, () =>
          emit({
            type: "command",
            actor: "frontend",
            summary: `SSE POST ${path} done (${deltaChunks} deltas, ${deltaChars} chars)`,
            details: { donePayload: data, deltaChunks, deltaChars },
            durationMs: Date.now() - sseStartedAt,
            status: "ok",
          }),
        );
      }
      handlers.onDone?.(data as TDone);
    } else if (eventName === "error") {
      const message = (data as { error?: string } | null)?.error ?? "stream error";
      streamError = message;
      if (DEV_LOG_ENABLED) {
        withParent(sseStartLogId, () =>
          emit({
            type: "command",
            actor: "frontend",
            summary: `SSE POST ${path} ✗ ${message}`,
            details: { error: message, deltaChunks, deltaChars },
            durationMs: Date.now() - sseStartedAt,
            status: "error",
          }),
        );
      }
      handlers.onError?.(message);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (frame.trim()) dispatchFrame(frame);
    }
  }
  if (buffer.trim()) dispatchFrame(buffer);

  if (streamError) throw new Error(streamError);
}
