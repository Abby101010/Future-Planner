/* ──────────────────────────────────────────────────────────
   Starward — correlation-ID middleware

   Reads X-Correlation-Id from the incoming request, generates
   one if absent, and runs the rest of the request inside an
   AsyncLocalStorage scope so anything downstream can grab it
   via getCorrelationId(). Also echoes the value back as a
   response header so the client can cross-reference logs.
   ────────────────────────────────────────────────────────── */

import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { runWithRequestContext } from "./requestContext";

const HEADER = "x-correlation-id";

export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header(HEADER);
  const correlationId = incoming && incoming.trim().length > 0 ? incoming : randomUUID();
  res.setHeader("X-Correlation-Id", correlationId);
  runWithRequestContext({ correlationId }, () => next());
}
