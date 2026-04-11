/* NorthStar server — auth middleware
 *
 * Phase 1: Hardcoded single-user mode. Reads DEV_USER_ID from env and
 * sets req.userId to it on every request. Still requires an Authorization
 * header (any value) so the client-side code is already sending one by the
 * time we swap to real auth.
 *
 * Phase 2: Replace the body with JWT verification against Supabase Auth
 * (or Clerk, or whatever). The req.userId contract stays identical, so
 * every route keeps working unchanged.
 *
 * THE ONLY PLACE THE USER ID IS DECIDED. If you find yourself hardcoding
 * "sophie" anywhere else, stop and put it here instead.
 */

import type { Request, Response, NextFunction } from "express";
import { runWithUserId } from "./requestContext";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

/**
 * Extract a bearer token from a raw Authorization header value.
 * Returns null when the header is missing or not a Bearer scheme.
 * Shared between the Express middleware and the WS upgrade handler
 * so there is exactly one place that knows the token format.
 */
export function extractBearerToken(headerValue: string | undefined | null): string | null {
  if (!headerValue) return null;
  if (!headerValue.toLowerCase().startsWith("bearer ")) return null;
  const token = headerValue.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Validate a bearer token and resolve a userId.
 *
 * Phase 1: single-user mode — any non-empty token is accepted and the
 * userId comes from DEV_USER_ID. Phase 2 will replace this body with
 * real JWT verification; the return contract stays the same so the
 * WS upgrade handler and the Express middleware can keep sharing it.
 *
 * Returns `null` when the token is missing/invalid OR when auth is not
 * configured — callers should translate that to a 401 response.
 */
export async function validateBearerToken(
  token: string | null | undefined,
): Promise<{ userId: string } | null> {
  if (!token) return null;

  const devUserId = process.env.DEV_USER_ID;
  if (devUserId) {
    // Phase 1: the token value is ignored; presence is enough.
    return { userId: devUserId };
  }

  // Phase 2 placeholder — real JWT verification will go here. Until
  // then, an unset DEV_USER_ID is a hard failure so we don't silently
  // grant access.
  return null;
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.header("authorization") || req.header("Authorization");
  const token = extractBearerToken(header);
  if (!token) {
    res.status(401).json({ ok: false, error: "missing Authorization header" });
    return;
  }

  const devUserId = process.env.DEV_USER_ID;
  if (devUserId) {
    // Phase 1: single-user mode. The token value is ignored; the middleware
    // only requires that SOMETHING is sent so the client code path is
    // already exercising the auth-header flow.
    req.userId = devUserId;
    // Run the rest of the request inside an AsyncLocalStorage context so
    // deeply-nested code (memory loaders, AI handlers) can read userId
    // without it being threaded through every function signature.
    runWithUserId(devUserId, () => next());
    return;
  }

  // Phase 2 placeholder — when DEV_USER_ID is unset, real JWT verification
  // would happen here. For now this is a hard error to prevent silent
  // "everyone is the same user" bugs in a supposedly-multi-user build.
  res.status(501).json({
    ok: false,
    error:
      "auth not configured: set DEV_USER_ID (phase 1) or implement JWT verification (phase 2)",
  });
}
