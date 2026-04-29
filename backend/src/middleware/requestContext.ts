/* Starward backend — request-scoped context
 *
 * AsyncLocalStorage so deeply-nested code (memory loaders, AI handlers)
 * can access the current request's userId without threading it through
 * every function signature. authMiddleware sets it for the lifetime of
 * each request; anything called from inside that request can read it
 * with getCurrentUserId().
 *
 * Falls back to throwing if used outside a request — that's intentional,
 * any caller that needs userId outside a request flow has a bug.
 */

import { AsyncLocalStorage } from "node:async_hooks";

interface RequestContext {
  userId: string;
  /** Correlation ID for the originating user action. Set by the correlation
   *  middleware on every HTTP request and propagated automatically through
   *  AsyncLocalStorage. Empty string when running outside a request. */
  correlationId?: string;
  /** logId of the dev-log operation currently in-flight in this scope.
   *  Nested ops (DB queries, AI calls, agent runs) read this and emit
   *  with it as parentId so the dev log is a tree, not a flat list. */
  currentLogId?: string | null;
}

const als = new AsyncLocalStorage<RequestContext>();

/** Run a body of work with a userId, merging with any existing scope so
 *  prior fields (correlationId set by upstream middleware) are preserved. */
export function runWithUserId<T>(userId: string, fn: () => T): T {
  const parent = als.getStore();
  return als.run({ ...parent, userId }, fn);
}

/** Extend the current request context with arbitrary dev-log fields.
 *  Used by the correlation middleware and the instrument() helper to
 *  thread correlationId / currentLogId without touching call signatures. */
export function runWithRequestContext<T>(
  patch: Partial<RequestContext>,
  fn: () => T,
): T {
  const parent = als.getStore() ?? { userId: "" };
  return als.run({ ...parent, ...patch }, fn);
}

export function getCurrentUserId(): string {
  const ctx = als.getStore();
  if (!ctx) {
    throw new Error(
      "getCurrentUserId() called outside a request context — did you forget runWithUserId()?",
    );
  }
  return ctx.userId;
}

/** Returns userId or null if there is no active request — for code paths
 *  that have a sensible fallback (e.g. memory loaders that can return
 *  EMPTY_MEMORY rather than crashing). */
export function tryGetCurrentUserId(): string | null {
  return als.getStore()?.userId ?? null;
}

/** Returns the correlation ID for the current request, or "" if there
 *  isn't one (e.g. background jobs that don't run inside a request). */
export function getCorrelationId(): string {
  return als.getStore()?.correlationId ?? "";
}

/** Returns the logId of the currently-instrumented operation, or null if
 *  no instrument() wrapper is active in this scope. Used by lower-level
 *  emitters (DB pool, WS broadcast) to set parentId. */
export function getCurrentLogId(): string | null {
  return als.getStore()?.currentLogId ?? null;
}
