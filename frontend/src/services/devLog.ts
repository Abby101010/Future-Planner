/* ──────────────────────────────────────────────────────────
   Starward — Dev-mode action log: renderer side

   Mints correlation IDs at user-action roots, captures clicks
   and navigation, ships entries to the backend writer over the
   existing WebSocket as `dev:action` envelopes. Buffers entries
   in memory when the socket is down; replays on reconnect.

   Dev-mode gated. With `import.meta.env.DEV === false` or the
   VITE_NORTHSTAR_DEV_LOGGING flag absent, every export is a
   no-op and the click/submit listeners are never attached.
   ────────────────────────────────────────────────────────── */

import {
  redactDetails,
  type DevLogActor,
  type DevLogEntryInput,
  type DevLogType,
} from "@starward/core";
import type { Envelope } from "@starward/core";
import { wsClient } from "./wsClient";
import useStore from "../store/useStore";

export const DEV_LOG_ENABLED =
  Boolean(import.meta.env.DEV) &&
  (import.meta.env.VITE_NORTHSTAR_DEV_LOGGING as string | undefined) === "1";

const DEV_LOG_FULL_PAYLOADS =
  DEV_LOG_ENABLED &&
  (import.meta.env.VITE_NORTHSTAR_DEV_LOGGING_FULL as string | undefined) === "1";

let currentCid = "";
let currentLogId: string | null = null;

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback (older browsers) — unlikely path on modern Electron renderer.
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Mint a fresh correlation ID for a new user-action root (click,
 *  submit, navigation, programmatic action). Resets the parent chain. */
export function rootAction(): string {
  if (!DEV_LOG_ENABLED) return "";
  currentCid = uuid();
  currentLogId = null;
  return currentCid;
}

export function currentCorrelationId(): string {
  return currentCid;
}

export function currentParentId(): string | null {
  return currentLogId;
}

/** Briefly use a specific logId as the parent for nested ops emitted
 *  inside `fn`. Pairs with reserveLogId() in instrumentation. */
export function withParent<T>(parentId: string, fn: () => T): T {
  const prev = currentLogId;
  currentLogId = parentId;
  try {
    return fn();
  } finally {
    currentLogId = prev;
  }
}

/** Emit a dev-log entry. Returns the entry's logId so callers can use it
 *  as parentId for subsequent children. */
export function emit(input: {
  type: DevLogType;
  actor: DevLogActor;
  summary: string;
  details?: Record<string, unknown>;
  durationMs?: number;
  status?: "ok" | "error" | "pending";
  /** Override the auto-resolved cid (rare — set when emitting on behalf of another root). */
  correlationId?: string;
  /** Override the auto-resolved parentId. */
  parentId?: string | null;
}): string {
  if (!DEV_LOG_ENABLED) return "";
  const logId = uuid();
  const entry: DevLogEntryInput & { logId: string } = {
    logId,
    type: input.type,
    actor: input.actor,
    correlationId: input.correlationId ?? currentCid ?? "",
    parentId: input.parentId === undefined ? currentLogId : input.parentId,
    summary: input.summary,
    details: redactDetails(input.details ?? {}, { full: DEV_LOG_FULL_PAYLOADS }),
    durationMs: input.durationMs,
    status: input.status,
  };
  ship(entry);
  return logId;
}

function ship(entry: DevLogEntryInput): void {
  // Primary path: hand the entry to the Electron main process via IPC,
  // which writes it to dev-logs/frontend-session-{ISO}.jsonl. Always
  // available in Electron; undefined in a plain browser context.
  const bridge = window.electronDevLog;
  if (bridge) {
    void bridge.append(entry).catch(() => {
      /* swallow — never let logging break the app */
    });
    return;
  }
  // Browser-only fallback: nothing to do. The IPC bridge is only present
  // in Electron, and the dev-log is dev-only — vite preview / web is
  // expected to drop entries silently.
}

/** Initialize document-level capture for clicks, form submits, and
 *  navigation. Idempotent — calling twice is a no-op. */
let initialized = false;
export function initDevLog(): void {
  if (!DEV_LOG_ENABLED || initialized) return;
  initialized = true;

  document.addEventListener("click", onDocClick, true);
  document.addEventListener("submit", onDocSubmit, true);

  // Inbound WS frames → ws.recv entries. Skip heartbeat pongs.
  wsClient.setFrameLogHook((env: Envelope<unknown>) => {
    if (env.kind === "pong") return;
    emit({
      type: "ws.recv",
      actor: "ws",
      summary: `recv ${env.kind}${env.streamId ? ` stream=${env.streamId.slice(0, 8)}` : ""}`,
      details: {
        kind: env.kind,
        streamId: env.streamId,
        data: env.data,
      },
      // Server-pushed frames carry their originating correlationId so the
      // entry threads back to the user action that caused the broadcast.
      correlationId: env.correlationId,
      parentId: null,
    });
  });

  // Navigation: react to currentView changes in the Zustand store.
  let lastView: string | null = useStore.getState().currentView;
  useStore.subscribe((state) => {
    if (state.currentView === lastView) return;
    const from = lastView;
    lastView = state.currentView;
    if (from === null) return;
    rootAction();
    emit({
      type: "nav",
      actor: "user",
      summary: `nav ${from} → ${state.currentView}`,
      details: { from, to: state.currentView },
    });
  });

  // Best-effort initial entry so the renderer marks itself in the log.
  rootAction();
  emit({
    type: "system" as DevLogType,
    actor: "frontend",
    summary: "renderer dev-log initialized",
    details: {
      url: typeof location !== "undefined" ? location.href : "",
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    },
  });
}

function describeTarget(el: Element | null): {
  summary: string;
  details: Record<string, unknown>;
} {
  if (!el) return { summary: "click <unknown>", details: {} };
  const dataAction = el.closest("[data-action]")?.getAttribute("data-action") ?? null;
  const button = el.closest("button");
  const buttonText = button?.textContent?.trim().slice(0, 60) ?? null;
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute("role");
  const id = el.id || null;
  const cls = el.className && typeof el.className === "string" ? el.className : null;
  const summary = dataAction
    ? `click [data-action=${dataAction}]`
    : buttonText
      ? `click "${buttonText}"`
      : `click <${tag}${id ? `#${id}` : ""}>`;
  return {
    summary,
    details: { tag, dataAction, buttonText, role, id, class: cls },
  };
}

function onDocClick(e: MouseEvent): void {
  const target = e.target;
  if (!(target instanceof Element)) return;
  rootAction();
  const { summary, details } = describeTarget(target);
  emit({ type: "user.click", actor: "user", summary, details });
}

function onDocSubmit(e: SubmitEvent): void {
  const form = e.target;
  if (!(form instanceof HTMLFormElement)) return;
  rootAction();
  const action = form.getAttribute("action") || form.dataset.action || "";
  const id = form.id || "";
  emit({
    type: "user.submit",
    actor: "user",
    summary: `submit ${id ? `#${id}` : action || "<form>"}`,
    details: { id, action, name: form.name || null },
  });
}
