/* NorthStar server — repository user context helper
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

/** Pull the current request's userId. Throws UnauthenticatedError if missing. */
export function requireUserId(): string {
  const userId = tryGetCurrentUserId();
  if (!userId) throw new UnauthenticatedError();
  return userId;
}
