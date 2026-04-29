/* ──────────────────────────────────────────────────────────
   Starward — Dev-mode action log: shared schema

   Pure types and a couple of pure helpers. No fs, no env, no
   Node-only imports — this module ships into the renderer
   bundle through the @starward/core barrel.
   ────────────────────────────────────────────────────────── */

export type DevLogActor =
  | "user"
  | "frontend"
  | "backend"
  | "ai"
  | "db"
  | "ws"
  | `agent:${string}`;

export type DevLogType =
  | "user.click"
  | "user.submit"
  | "nav"
  | "command"
  | "query"
  | "db"
  | "ws.send"
  | "ws.recv"
  | "agent"
  | "ai"
  | "system";

export type DevLogStatus = "ok" | "error" | "pending";

/** A finished log entry as written to disk. */
export interface DevLogEntry {
  ts: string;
  logId: string;
  correlationId: string;
  parentId: string | null;
  type: DevLogType;
  actor: DevLogActor;
  summary: string;
  details: Record<string, unknown>;
  durationMs?: number;
  status?: DevLogStatus;
  userId?: string;
  seq: number;
}

/** What callers pass to emit. Writer fills in logId, ts, seq. */
export type DevLogEntryInput = Omit<DevLogEntry, "logId" | "ts" | "seq">;
