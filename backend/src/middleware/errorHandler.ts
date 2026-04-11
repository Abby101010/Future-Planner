/* NorthStar server — error envelope middleware
 *
 * Matches the IPC return shape the renderer already expects:
 *   { ok: false, error: string }
 *
 * Any uncaught error in a route handler ends up here. Routes can also throw
 * explicitly and rely on this to format the response.
 */

import type { Request, Response, NextFunction } from "express";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[server] Unhandled error:", err);
  if (!res.headersSent) {
    res.status(500).json({ ok: false, error: message });
  }
}

/**
 * Wrap an async route handler so thrown errors are forwarded to the Express
 * error pipeline instead of crashing the process. Express 5 handles this
 * natively for async functions but being explicit is cheaper than debugging.
 */
export function asyncHandler(
  fn: (req: Request, res: Response) => Promise<unknown>,
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };
}
