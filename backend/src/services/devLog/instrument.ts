/* ──────────────────────────────────────────────────────────
   Starward — Dev-mode action log: instrument() helper

   Wraps an async operation with start + complete dev-log
   entries. The pre-allocated logId is exposed via ALS as
   currentLogId, so anything emitted from inside (DB queries,
   AI calls, WS sends, nested instrument() calls) attaches as
   a child via parentId.
   ────────────────────────────────────────────────────────── */

import { randomUUID } from "node:crypto";
import type { DevLogActor, DevLogType } from "@starward/core";
import {
  getCorrelationId,
  getCurrentLogId,
  runWithRequestContext,
} from "../../middleware/requestContext";
import { DEV_LOG_ENABLED, emitDevLog } from "./index";

export interface InstrumentOptions<T> {
  type: DevLogType;
  actor: DevLogActor;
  /** One-line summary recorded on the "start" entry. */
  startSummary: string;
  /** Optional details on the "start" entry (request payload, etc.). */
  startDetails?: Record<string, unknown>;
  /** Override summary on success — receives result + durationMs. */
  endSummary?: (result: T, durationMs: number) => string;
  /** Override details on success. */
  endDetails?: (result: T) => Record<string, unknown>;
  /** Override summary on error. */
  errorSummary?: (err: unknown, durationMs: number) => string;
  /** Optional userId override (defaults to ALS userId). */
  userId?: string;
}

/** Emit start + complete entries around an async operation. The pre-
 *  allocated logId is set as currentLogId in ALS so nested ops attach
 *  as children. Disabled-state cost is one boolean check. */
export async function instrument<T>(
  opts: InstrumentOptions<T>,
  fn: () => Promise<T>,
): Promise<T> {
  if (!DEV_LOG_ENABLED) return fn();

  const correlationId = getCorrelationId() || "no-correlation";
  const parentId = getCurrentLogId();
  const logId = randomUUID();
  const t0 = Date.now();

  emitDevLog(
    {
      type: opts.type,
      actor: opts.actor,
      correlationId,
      parentId,
      summary: opts.startSummary,
      details: opts.startDetails ?? {},
      status: "pending",
      userId: opts.userId,
    },
    logId,
  );

  return runWithRequestContext({ currentLogId: logId }, async () => {
    try {
      const result = await fn();
      const durationMs = Date.now() - t0;
      emitDevLog({
        type: opts.type,
        actor: opts.actor,
        correlationId,
        parentId,
        summary: opts.endSummary
          ? opts.endSummary(result, durationMs)
          : `${opts.startSummary} ✓ (${durationMs}ms)`,
        details: opts.endDetails ? opts.endDetails(result) : {},
        durationMs,
        status: "ok",
        userId: opts.userId,
      });
      return result;
    } catch (err) {
      const durationMs = Date.now() - t0;
      const message = err instanceof Error ? err.message : String(err);
      emitDevLog({
        type: opts.type,
        actor: opts.actor,
        correlationId,
        parentId,
        summary: opts.errorSummary
          ? opts.errorSummary(err, durationMs)
          : `${opts.startSummary} ✗ ${message}`,
        details: {
          error: message,
          stack: err instanceof Error ? err.stack : undefined,
        },
        durationMs,
        status: "error",
        userId: opts.userId,
      });
      throw err;
    }
  });
}

/** One-shot emit for atomic operations (DB queries, WS sends, click
 *  events). Reads correlationId + parentId from ALS automatically. */
export function emitOperation(input: {
  type: DevLogType;
  actor: DevLogActor;
  summary: string;
  details?: Record<string, unknown>;
  durationMs?: number;
  status?: "ok" | "error";
  userId?: string;
}): string {
  if (!DEV_LOG_ENABLED) return "";
  return emitDevLog({
    type: input.type,
    actor: input.actor,
    correlationId: getCorrelationId() || "no-correlation",
    parentId: getCurrentLogId(),
    summary: input.summary,
    details: input.details ?? {},
    durationMs: input.durationMs,
    status: input.status,
    userId: input.userId,
  });
}
