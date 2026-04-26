/* Starward server — repository user context helper
 *
 * Thin wrapper around getCurrentUserId() that throws a 401-flavored error
 * if called outside a request context. Every repository function uses this
 * instead of reaching into AsyncLocalStorage directly so the error shape is
 * consistent and so we have a single place to change auth behavior later.
 *
 * This helper is an internal module (prefixed with _) and is not exported
 * from the barrel.
 */

import { tryGetCurrentUserId } from "../middleware/requestContext";

export class UnauthenticatedError extends Error {
  public readonly status = 401;
  constructor(message = "Unauthenticated: no userId in request context") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

/**
 * Thrown when a mutation targets an entity id that doesn't exist (or
 * doesn't belong to the current user). Lets callers and the route
 * layer surface the failure to the user instead of silently treating
 * a no-op UPDATE/DELETE as success.
 *
 * This exists because the prior "log a warning and return void" pattern
 * (remindersRepo.acknowledge/remove pre-2026-04-26) made the FE think
 * a check-off succeeded when nothing had actually changed, leaving the
 * row in place after refetch — producing the "I can't check off my
 * reminders" symptom with no error message.
 *
 * Use only in repo mutations where a 0-row result indicates a real
 * caller bug (wrong id, wrong user, or a race with delete). Do NOT
 * use in idempotent sweeps (cleanupPastAcknowledged, markStaleAsSkipped),
 * where a 0-row result is a normal "nothing to do" outcome.
 */
export class EntityNotFoundError extends Error {
  public readonly status = 404;
  constructor(
    public readonly entity: string,
    public readonly id: string,
  ) {
    super(`${entity} ${id} not found for current user`);
    this.name = "EntityNotFoundError";
  }
}

/** Pull the current request's userId. Throws UnauthenticatedError if missing. */
export function requireUserId(): string {
  const userId = tryGetCurrentUserId();
  if (!userId) throw new UnauthenticatedError();
  return userId;
}
