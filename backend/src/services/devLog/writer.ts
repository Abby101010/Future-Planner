/* ──────────────────────────────────────────────────────────
   Starward — Dev-mode action log: writer

   Backend-only. Append JSONL to dev-logs/session-{ts}.jsonl,
   batched flush, ring-buffer backpressure, session rotation
   (keep last 20). Never blocks callers — emit() is sync,
   actual disk write is deferred.
   ────────────────────────────────────────────────────────── */

import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { redactDetails, type DevLogEntry, type DevLogEntryInput } from "@starward/core";

const MAX_SESSIONS = 20;
const FLUSH_INTERVAL_MS = 100;
const SOFT_BUFFER_LIMIT = 256;
const HARD_BUFFER_LIMIT = 4096;

function defaultLogsDir(): string {
  // From backend/src/services/devLog/writer.ts (or backend/dist/.../writer.js),
  // four levels up lands at the repo root.
  return path.resolve(__dirname, "..", "..", "..", "..", "dev-logs");
}

function sessionFilename(): string {
  // ISO with ":" and "." replaced for filesystem safety; still sortable.
  // Prefixed `backend-` so it sorts adjacent to `frontend-session-*` files
  // produced by the Electron-main writer when both are running.
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `backend-session-${ts}.jsonl`;
}

export interface DevLogWriterOptions {
  logsDir?: string;
  /** When true, do not truncate or cap object size in details. */
  fullPayloads?: boolean;
}

export class DevLogWriter {
  private logsDir: string;
  private fullPayloads: boolean;
  private filePath = "";
  private stream: WriteStream | null = null;
  private buffer: string[] = [];
  private dropped = 0;
  private seq = 0;
  private flushTimer: NodeJS.Timeout | null = null;
  private warnTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;
  private signalHandler: () => void;

  constructor(opts: DevLogWriterOptions = {}) {
    this.logsDir = opts.logsDir ?? defaultLogsDir();
    this.fullPayloads = opts.fullPayloads ?? false;
    this.signalHandler = () => {
      void this.shutdown();
    };
  }

  async init(): Promise<void> {
    await mkdir(this.logsDir, { recursive: true });
    await this.prune();
    this.filePath = path.join(this.logsDir, sessionFilename());
    this.stream = createWriteStream(this.filePath, { flags: "a" });
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    this.flushTimer.unref?.();
    process.on("SIGINT", this.signalHandler);
    process.on("SIGTERM", this.signalHandler);
    this.enqueue({
      type: "system",
      actor: "backend",
      correlationId: "session",
      parentId: null,
      summary: `dev-log session start → ${path.basename(this.filePath)}`,
      details: {
        pid: process.pid,
        cwd: process.cwd(),
        nodeVersion: process.version,
        nodeEnv: process.env.NODE_ENV,
      },
    });
  }

  /** Synchronous enqueue. Returns the entry's logId so callers can use
   *  it as parentId for nested ops. Pass `presetLogId` when the caller
   *  has already reserved an ID (e.g. instrument() pre-allocates so
   *  children can attach before the parent's "complete" entry lands). */
  enqueue(input: DevLogEntryInput, presetLogId?: string): string {
    if (this.shuttingDown || !this.stream) return "";
    const logId = presetLogId ?? randomUUID();
    const entry: DevLogEntry = {
      ...input,
      details: redactDetails(input.details, { full: this.fullPayloads }),
      ts: new Date().toISOString(),
      logId,
      seq: this.seq++,
    };
    let line: string;
    try {
      line = JSON.stringify(entry) + "\n";
    } catch {
      // Unserializable details — emit a thin replacement so the chain is intact.
      line =
        JSON.stringify({
          ...entry,
          details: { _unserializable: true },
        }) + "\n";
    }
    if (this.buffer.length >= HARD_BUFFER_LIMIT) {
      this.buffer.shift();
      this.dropped++;
      this.scheduleDropWarn();
    }
    this.buffer.push(line);
    if (this.buffer.length >= SOFT_BUFFER_LIMIT) this.flush();
    return logId;
  }

  flush(): void {
    if (!this.stream || this.buffer.length === 0) return;
    const chunk = this.buffer.join("");
    this.buffer.length = 0;
    this.stream.write(chunk);
  }

  private scheduleDropWarn(): void {
    if (this.warnTimer) return;
    this.warnTimer = setTimeout(() => {
      console.warn(`[dev-log] dropped ${this.dropped} entries (writer wedged?)`);
      this.dropped = 0;
      this.warnTimer = null;
    }, 1000);
    this.warnTimer.unref?.();
  }

  /** Keep the most recent (MAX_SESSIONS - 1) sessions; we're about to add one. */
  private async prune(): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(this.logsDir);
    } catch {
      return;
    }
    const sessions = entries.filter(
      (f) => f.startsWith("backend-session-") && f.endsWith(".jsonl"),
    );
    const stats = await Promise.all(
      sessions.map(async (f) => {
        const full = path.join(this.logsDir, f);
        try {
          const s = await stat(full);
          return { full, mtime: s.mtimeMs };
        } catch {
          return { full, mtime: 0 };
        }
      }),
    );
    stats.sort((a, b) => b.mtime - a.mtime);
    const toDelete = stats.slice(MAX_SESSIONS - 1);
    await Promise.all(toDelete.map((s) => unlink(s.full).catch(() => {})));
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.warnTimer) {
      clearTimeout(this.warnTimer);
      this.warnTimer = null;
    }
    this.flush();
    if (this.stream) {
      const stream = this.stream;
      this.stream = null;
      await new Promise<void>((resolve) => stream.end(() => resolve()));
    }
    process.off("SIGINT", this.signalHandler);
    process.off("SIGTERM", this.signalHandler);
  }

  get currentFilePath(): string {
    return this.filePath;
  }
}
