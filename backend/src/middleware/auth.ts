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

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.header("authorization") || req.header("Authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
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
    error: "auth not configured: set DEV_USER_ID (phase 1) or implement JWT verification (phase 2)",
  });
}
