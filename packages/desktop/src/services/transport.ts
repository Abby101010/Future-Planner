/* NorthStar — standardized view/command transport (Phase 5b)
 *
 * Thin client over the server's new /view/:kind and /commands/:kind routes.
 * Every response is a standardized `Envelope<T>` from @northstar/core; this
 * module validates the protocol version, throws on `ok: false`, and returns
 * `envelope.data` on success.
 *
 * Coexists with the legacy `cloudTransport.ts` module — callers that still
 * use channel-based IPC should keep using that one. Phase 5b's `useQuery`
 * and `useCommand` hooks are the only callers of this file today.
 */

import type { Envelope, QueryKind, CommandKind } from "@northstar/core";
import { PROTOCOL_VERSION } from "@northstar/core";
import { getAuthToken } from "./auth";
import { createLogger } from "../utils/logger";

const log = createLogger("transport");

const DEFAULT_QUERY_TIMEOUT_MS = 30_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;

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

  try {
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getAuthToken()}`,
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
      throw new Error(`${parsed.kind}: ${err.code} — ${err.message}`);
    }

    log.debug(`${method} ${path} ← ok (${elapsed}ms)`);
    return parsed.data as T;
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
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
