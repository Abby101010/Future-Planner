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
}

const als = new AsyncLocalStorage<RequestContext>();

export function runWithUserId<T>(userId: string, fn: () => T): T {
  return als.run({ userId }, fn);
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
