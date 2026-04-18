/* NorthStar server — typed WS event emitters
 *
 * One function per EventKind from @northstar/core. Each takes a
 * userId and a payload, wraps the payload in the standardized
 * envelope, and fans it out to every socket that user has connected.
 *
 * These are the ONLY sanctioned way to push data to WS clients. Do
 * not call registry.broadcastToUser(...) directly from route handlers;
 * always go through a helper here so the envelope `kind` stays in
 * sync with the EventKind union.
 *
 * Phase 3b note: nothing actually calls these yet — AI streaming
 * (Task 16) and reminders (later) will be the first callers.
 */

import { envelope } from "@northstar/core";
import type { QueryKind } from "@northstar/core";
import { connectionRegistry } from "./connections";

/** Payload for `ai:stream-start`. */
export interface AiStreamStartPayload {
  streamId: string;
  /** High-level kind of stream — e.g. "chat", "goal-plan", "recovery". */
  kind: string;
}

/** Payload for `ai:token-delta`. */
export interface AiTokenDeltaPayload {
  streamId: string;
  delta: string;
}

/** Payload for `ai:stream-end`. */
export interface AiStreamEndPayload {
  streamId: string;
  finishReason?: string;
}

/** Payload for `agent:progress`. */
export interface AgentProgressPayload {
  agentId: string;
  phase: string;
  message?: string;
  percent?: number;
}

/** Payload for `view:invalidate`. Clients use this to re-fetch views.
 *  Optional `scope` lets the client skip refetches for irrelevant dates/entities. */
export interface ViewInvalidatePayload {
  viewKinds: QueryKind[];
  scope?: {
    date?: string;
    entityId?: string;
    entityType?: string;
  };
}

/** Payload for `reminder:triggered`. */
export interface ReminderTriggeredPayload {
  reminderId: string;
  title: string;
  body?: string;
}

export function emitAiStreamStart(
  userId: string,
  payload: AiStreamStartPayload,
): void {
  connectionRegistry.broadcastToUser(
    userId,
    envelope("ai:stream-start", payload, payload.streamId),
  );
}

export function emitAiTokenDelta(
  userId: string,
  payload: AiTokenDeltaPayload,
): void {
  connectionRegistry.broadcastToUser(
    userId,
    envelope("ai:token-delta", payload, payload.streamId),
  );
}

export function emitAiStreamEnd(
  userId: string,
  payload: AiStreamEndPayload,
): void {
  connectionRegistry.broadcastToUser(
    userId,
    envelope("ai:stream-end", payload, payload.streamId),
  );
}

export function emitAgentProgress(
  userId: string,
  payload: AgentProgressPayload,
): void {
  connectionRegistry.broadcastToUser(
    userId,
    envelope("agent:progress", payload),
  );
}

export function emitViewInvalidate(
  userId: string,
  payload: ViewInvalidatePayload,
): void {
  connectionRegistry.broadcastToUser(
    userId,
    envelope("view:invalidate", payload),
  );
}

export function emitReminderTriggered(
  userId: string,
  payload: ReminderTriggeredPayload,
): void {
  connectionRegistry.broadcastToUser(
    userId,
    envelope("reminder:triggered", payload),
  );
}

/** Payload for `job:complete`. */
export interface JobCompletePayload {
  jobId: string;
  type: string;
  result: Record<string, unknown>;
}

/** Payload for `job:failed`. */
export interface JobFailedPayload {
  jobId: string;
  type: string;
  error: string;
}

export function emitJobComplete(
  userId: string,
  payload: JobCompletePayload,
): void {
  connectionRegistry.broadcastToUser(
    userId,
    envelope("job:complete", payload),
  );
}

export function emitJobFailed(
  userId: string,
  payload: JobFailedPayload,
): void {
  connectionRegistry.broadcastToUser(
    userId,
    envelope("job:failed", payload),
  );
}

/** Payload for `entity:patch` — direct state push for simple mutations. */
export interface EntityPatchPayload {
  entityType: "task" | "goal" | "reminder";
  entityId: string;
  patch: Record<string, unknown>;
  date?: string;
}

export function emitEntityPatch(
  userId: string,
  payload: EntityPatchPayload,
): void {
  connectionRegistry.broadcastToUser(
    userId,
    envelope("entity:patch", payload),
  );
}
