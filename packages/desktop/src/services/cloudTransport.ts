/* NorthStar — cloud transport
 *
 * Single seam that decides whether an IPC channel is served by the local
 * Electron backend or by the cloud HTTP API. The choice is global:
 *
 *   • If VITE_CLOUD_API_URL is set at build time, every channel listed in
 *     CLOUD_CHANNELS routes through fetch() to that base URL.
 *   • If VITE_CLOUD_API_URL is empty/unset, every call falls through to the
 *     local IPC bridge (the original Electron-only behavior).
 *
 * This lets the same renderer build run in two modes:
 *   - Dev (no env var): pure local Electron + SQLite, exactly like before.
 *   - Cloud (env var set in CI for the .dmg): local Electron shell, but
 *     migrated channels hit the Fly/Supabase backend.
 *
 * IMPORTANT: callers should NEVER read the env var or fetch directly.
 * Always go through `cloudInvoke` (or, more commonly, the wrappers in
 * `src/repositories/index.ts` and `src/services/ai.ts` which dispatch
 * here under the hood). Centralizing transport keeps the multi-user-ready
 * checklist (Authorization header on every request, no hardcoded user IDs)
 * enforceable in one place.
 */

import { getAuthToken } from "./auth";
import { createLogger } from "../utils/logger";

const log = createLogger("ai:transport");

const CLOUD_API_URL = (
  (import.meta.env.VITE_CLOUD_API_URL as string | undefined) || ""
).replace(/\/$/, "");

/**
 * The complete set of IPC channels that have a server-side mirror in
 * server/src/routes/. Anything NOT in this set stays on local IPC, even
 * when the cloud is enabled — that's how memory:*, job:*, chat:*,
 * device:*, and environment:* keep working in phase 1.
 *
 * Mirrors the route registrations in server/src/index.ts. Keep these in
 * sync when you migrate a new domain.
 */
export const CLOUD_CHANNELS: ReadonlySet<string> = new Set([
  // entities
  "entities:new-goal",
  "entities:new-event",
  "entities:new-user",
  "entities:new-log",
  "entities:new-chat-session",
  "entities:new-chat-message",
  "entities:new-behavior-entry",
  "entities:new-confirmed-task",
  // ai
  "ai:onboarding",
  "ai:reallocate",
  "ai:daily-tasks",
  "ai:recovery",
  "ai:pace-check",
  "ai:classify-goal",
  "ai:goal-plan-chat",
  "ai:goal-plan-edit",
  "ai:generate-goal-plan",
  "ai:analyze-quick-task",
  "ai:analyze-monthly-context",
  "ai:home-chat",
  "ai:news-briefing",
  // calendar (device:* stays local — macOS-only)
  "calendar:list-events",
  "calendar:upsert-event",
  "calendar:delete-event",
  "calendar:schedule",
  // reminder
  "reminder:list",
  "reminder:upsert",
  "reminder:acknowledge",
  "reminder:delete",
  // monthly-context
  "monthly-context:list",
  "monthly-context:get",
  "monthly-context:upsert",
  "monthly-context:delete",
  "monthly-context:analyze",
  // model-config
  "model-config:get",
  "model-config:set-overrides",
  // chat sessions + attachments (slice 5: bytes stored inline as bytea)
  "chat:list-sessions",
  "chat:save-session",
  "chat:delete-session",
  "chat:save-attachment",
  "chat:get-attachments",
  // memory writes + reads (slice 2 thin port)
  "memory:load",
  "memory:summary",
  "memory:clear",
  "memory:signal",
  "memory:task-completed",
  "memory:task-snoozed",
  "memory:task-skipped",
  "memory:feedback",
  "memory:chat-insight",
  "memory:task-timing",
  // reflection / nudges (slice 3b — Postgres-backed reflection engine)
  "memory:reflect",
  "memory:nudges",
  "memory:should-reflect",
  // behavior profile (slice 4 — editable profile in Settings)
  "memory:behavior-profile",
  "memory:save-behavior-profile",
]);

/** True iff the build is configured to talk to a cloud backend. */
export function isCloudEnabled(): boolean {
  return CLOUD_API_URL.length > 0;
}

/**
 * True iff this specific channel should be routed to the cloud right now.
 * Returns false in dev (no env var) so everything falls through to IPC.
 */
export function isCloudChannel(channel: string): boolean {
  return isCloudEnabled() && CLOUD_CHANNELS.has(channel);
}

/**
 * Convert an IPC channel name to its HTTP path.
 *   "entities:new-goal" → "/entities/new-goal"
 *   "ai:home-chat"      → "/ai/home-chat"
 *   "monthly-context:upsert" → "/monthly-context/upsert"
 */
function channelToPath(channel: string): string {
  const idx = channel.indexOf(":");
  if (idx < 0) return `/${channel}`;
  return `/${channel.slice(0, idx)}/${channel.slice(idx + 1)}`;
}

/**
 * POST a payload to the cloud API and return the parsed JSON body.
 *
 * The server route shape mirrors the IPC handler shape byte-for-byte
 * (`{ ok, ... }` envelopes, raw AI handler returns), so callers don't
 * need to know whether they got the response from IPC or from fetch.
 *
 * Throws on network errors or non-2xx HTTP responses. Callers that want
 * to fall back to a default value should catch and handle locally —
 * we deliberately don't swallow errors here so failures are observable.
 */
export async function cloudInvoke<T>(
  channel: string,
  payload?: unknown,
): Promise<T> {
  if (!isCloudEnabled()) {
    throw new Error(
      `cloudInvoke called for "${channel}" but VITE_CLOUD_API_URL is not set`,
    );
  }
  const url = `${CLOUD_API_URL}${channelToPath(channel)}`;
  const started = Date.now();
  log.debug(`POST ${channel} → ${url}`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getAuthToken()}`,
        "X-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      body: JSON.stringify(payload ?? {}),
    });
    const elapsed = Date.now() - started;
    if (!res.ok) {
      let bodyText = "";
      try {
        bodyText = await res.text();
      } catch {
        /* ignore */
      }
      log.error(`${channel} HTTP ${res.status} (${elapsed}ms)`, bodyText.slice(0, 200));
      if (/credit balance|billing|too low/i.test(bodyText)) {
        throw new Error("AI features are temporarily unavailable — please check your API billing settings.");
      }
      throw new Error(
        `${channel} failed: HTTP ${res.status}${bodyText ? ` — ${bodyText.slice(0, 200)}` : ""}`,
      );
    }
    log.debug(`${channel} ← ${res.status} (${elapsed}ms)`);
    return (await res.json()) as T;
  } catch (err) {
    const elapsed = Date.now() - started;
    if (err instanceof TypeError) {
      log.error(`${channel} network error (${elapsed}ms)`, err.message);
    }
    throw err;
  }
}
