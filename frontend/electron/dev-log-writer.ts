/* ──────────────────────────────────────────────────────────
   Starward — Dev-mode action log: Electron-main writer

   Renderer cannot write disk (contextIsolation), and the
   deployed backend doesn't run our dev-log code, so the
   renderer ships entries to this main-process writer via
   IPC. Output goes to <repoRoot>/dev-logs/frontend-session-
   {ISO}.jsonl alongside the backend's own session file
   when both are running.

   Mirrors backend/src/services/devLog/writer.ts: append-only
   stream, ring buffer, 100ms flush, drop-warn at 4096,
   rotation keeping last 20 sessions. Same redactor.
   ────────────────────────────────────────────────────────── */

import { app } from "electron";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  redactDetails,
  type DevLogEntry,
  type DevLogEntryInput,
} from "../../backend/core/src/devLog/index";

const MAX_SESSIONS = 20;
const FLUSH_INTERVAL_MS = 100;
const SOFT_BUFFER_LIMIT = 256;
const HARD_BUFFER_LIMIT = 4096;

/** From the built file at <repo>/frontend/dist-electron/<bundle>.js,
 *  two levels up is the repo root. */
function defaultLogsDir(): string {
  return path.resolve(__dirname, "..", "..", "dev-logs");
}

function sessionFilename(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `frontend-session-${ts}.jsonl`;
}

export const DEV_LOG_ENABLED =
  !app.isPackaged && process.env.NORTHSTAR_DEV_LOGGING === "1";

const DEV_LOG_FULL_PAYLOADS =
  DEV_LOG_ENABLED && process.env.NORTHSTAR_DEV_LOGGING_FULL === "1";

class DevLogWriter {
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

  constructor(opts: { logsDir?: string; fullPayloads?: boolean } = {}) {
    this.logsDir = opts.logsDir ?? defaultLogsDir();
    this.fullPayloads = opts.fullPayloads ?? false;
  }

  async init(): Promise<void> {
    await mkdir(this.logsDir, { recursive: true });
    await this.prune();
    this.filePath = path.join(this.logsDir, sessionFilename());
    this.stream = createWriteStream(this.filePath, { flags: "a" });
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    this.flushTimer.unref?.();
    this.enqueue({
      type: "system",
      actor: "frontend",
      correlationId: "session",
      parentId: null,
      summary: `dev-log frontend session start → ${path.basename(this.filePath)}`,
      details: {
        pid: process.pid,
        nodeVersion: process.version,
        electronVersion: process.versions.electron,
      },
    });
  }

  enqueue(input: DevLogEntryInput): string {
    if (this.shuttingDown || !this.stream) return "";
    const logId = randomUUID();
    const entry: DevLogEntry = {
      ...input,
      details: redactDetails(input.details ?? {}, { full: this.fullPayloads }),
      ts: new Date().toISOString(),
      logId,
      seq: this.seq++,
    };
    let line: string;
    try {
      line = JSON.stringify(entry) + "\n";
    } catch {
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
      // eslint-disable-next-line no-console
      console.warn(`[dev-log] dropped ${this.dropped} renderer entries`);
      this.dropped = 0;
      this.warnTimer = null;
    }, 1000);
    this.warnTimer.unref?.();
  }

  private async prune(): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(this.logsDir);
    } catch {
      return;
    }
    const sessions = entries.filter(
      (f) => f.startsWith("frontend-session-") && f.endsWith(".jsonl"),
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
  }

  get currentFilePath(): string {
    return this.filePath;
  }
}

let writer: DevLogWriter | null = null;

export async function initDevLogMain(): Promise<void> {
  if (!DEV_LOG_ENABLED || writer) return;
  writer = new DevLogWriter({ fullPayloads: DEV_LOG_FULL_PAYLOADS });
  await writer.init();
  // eslint-disable-next-line no-console
  console.log(`[dev-log] writing renderer events to ${writer.currentFilePath}`);
}

export function appendDevLogMain(entry: DevLogEntryInput): string {
  if (!writer) return "";
  return writer.enqueue(entry);
}

export async function shutdownDevLogMain(): Promise<void> {
  if (!writer) return;
  await writer.shutdown();
  writer = null;
}
